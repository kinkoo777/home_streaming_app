// ================= HDR → SDR RENDERER =================
//
// Draws the <video> through a WebGL shader that tone-maps HDR (PQ / HLG,
// BT.2020) frames to SDR BT.709. Used for files whose colour tags the server
// rewrote to BT.709 (/stream): the browser then decodes the raw HDR signal as
// if it were SDR, and this shader undoes that and maps it properly.
//
// Usage:
//   const r = new HdrRenderer(video, canvas, { onFail })
//   r.start('pq')            // or 'hlg'
//   r.setExposure(1.2)
//   r.stop()

(function () {
  const VERT = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = a_pos * 0.5 + 0.5;
      v_uv.y = 1.0 - v_uv.y;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }`

  const FRAG = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform sampler2D u_tex;
    uniform float u_hlg;       // 0 = PQ, 1 = HLG
    uniform float u_peak;      // source peak, relative to SDR white
    uniform float u_exposure;
    varying vec2 v_uv;

    vec3 pqToLinear(vec3 e) {  // SMPTE ST 2084 EOTF, result in units of 10 000 nits
      const float m1 = 0.1593017578125;
      const float m2 = 78.84375;
      const float c1 = 0.8359375;
      const float c2 = 18.8515625;
      const float c3 = 18.6875;
      vec3 p = pow(max(e, 0.0), vec3(1.0 / m2));
      return pow(max(p - c1, 0.0) / (c2 - c3 * p), vec3(1.0 / m1));
    }

    float hlgInv(float e) {    // ARIB STD-B67 inverse OETF → scene linear
      const float a = 0.17883277;
      const float b = 0.28466892;
      const float c = 0.55991073;
      return e <= 0.5 ? e * e / 3.0 : (exp((e - c) / a) + b) / 12.0;
    }

    void main() {
      vec3 rgb = texture2D(u_tex, v_uv).rgb;

      // The browser converted YCbCr → RGB with BT.709 coefficients; undo that
      // and redo it with BT.2020 coefficients to recover the real signal.
      float y  = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
      float cb = (rgb.b - y) / 1.8556;
      float cr = (rgb.r - y) / 1.5748;
      vec3 e = clamp(vec3(y + 1.4746 * cr,
                          y - 0.16455 * cb - 0.57135 * cr,
                          y + 1.8814 * cb), 0.0, 1.0);

      // Linear light relative to SDR reference white (203 nits = 1.0).
      vec3 lin;
      if (u_hlg > 0.5) {
        vec3 s = vec3(hlgInv(e.r), hlgInv(e.g), hlgInv(e.b));
        float ys = dot(s, vec3(0.2627, 0.6780, 0.0593));
        lin = s * pow(max(ys, 1e-6), 0.2) * (1000.0 / 203.0);   // OOTF, 1000-nit display
      } else {
        lin = pqToLinear(e) * (10000.0 / 203.0);
      }

      // BT.2020 → BT.709 primaries.
      lin = mat3( 1.6605, -0.1246, -0.0182,
                 -0.5876,  1.1329, -0.1006,
                 -0.0728, -0.0083,  1.1187) * lin;
      lin = max(lin, 0.0) * u_exposure;

      // Tone curve on luminance: linear below the knee, soft roll-off to the peak.
      float l  = dot(lin, vec3(0.2126, 0.7152, 0.0722));
      const float ks = 0.75;
      float lt = l;
      if (l > ks) {
        float range = 1.0 - ks;
        float p  = max(u_peak - ks, 1e-3);
        float ex = l - ks;
        lt = ks + range * (ex / (ex + range)) * ((p + range) / p);
      }
      lin *= l > 1e-6 ? lt / l : 0.0;

      // Out-of-gamut highlights: scale into range instead of hue-shifting clip.
      float mx = max(max(lin.r, lin.g), lin.b);
      if (mx > 1.0) lin /= mx;

      gl_FragColor = vec4(pow(lin, vec3(1.0 / 2.2)), 1.0);
    }`

  function compile(gl, type, src) {
    const s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed')
    return s
  }

  class HdrRenderer {
    static supported() {
      try {
        const c = document.createElement('canvas')
        return !!(c.getContext('webgl') || c.getContext('experimental-webgl'))
      } catch { return false }
    }

    constructor(video, canvas, { onFail } = {}) {
      this.video    = video
      this.canvas   = canvas
      this.onFail   = onFail || (() => {})
      this.active   = false
      this.exposure = 1
      this.peak     = 1000 / 203
      this._frameCb = null
      this._checks  = 0
      this._blankHits = 0
    }

    _init() {
      if (this.gl) return
      const opts = { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' }
      const gl = this.canvas.getContext('webgl', opts) || this.canvas.getContext('experimental-webgl', opts)
      if (!gl) throw new Error('WebGL není k dispozici')
      const prog = gl.createProgram()
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT))
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG))
      gl.linkProgram(prog)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link failed')
      gl.useProgram(prog)

      const buf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(prog, 'a_pos')
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

      this.u = {
        hlg:      gl.getUniformLocation(prog, 'u_hlg'),
        peak:     gl.getUniformLocation(prog, 'u_peak'),
        exposure: gl.getUniformLocation(prog, 'u_exposure')
      }
      this.gl = gl

      this.canvas.addEventListener('webglcontextlost', e => {
        e.preventDefault()
        this._fail('WebGL kontext ztracen')
      })
    }

    start(transfer) {
      try {
        this._init()
      } catch (err) {
        this._fail(err.message)
        return false
      }
      this.transfer   = transfer === 'hlg' ? 'hlg' : 'pq'
      this.active     = true
      this._checks    = 0
      this._blankHits = 0
      this.canvas.classList.add('active')
      this.video.classList.add('under-canvas')
      this._loop()
      return true
    }

    stop() {
      this.active = false
      if (this._frameCb != null) {
        if (this.video.cancelVideoFrameCallback && this._usingVfc) this.video.cancelVideoFrameCallback(this._frameCb)
        else cancelAnimationFrame(this._frameCb)
        this._frameCb = null
      }
      this.canvas.classList.remove('active')
      this.video.classList.remove('under-canvas')
    }

    setExposure(x) { this.exposure = x; if (this.active && this.video.paused) this._draw() }

    _fail(reason) {
      console.warn('HDR renderer vypnut:', reason)
      const wasActive = this.active
      this.stop()
      if (wasActive || reason) this.onFail(reason)
    }

    _loop() {
      if (!this.active) return
      const next = () => { if (this.active) this._loop() }
      this._usingVfc = typeof this.video.requestVideoFrameCallback === 'function'
      if (this._usingVfc) {
        this._frameCb = this.video.requestVideoFrameCallback(() => { this._draw(); next() })
        // requestVideoFrameCallback doesn't fire while paused/seeking; keep the
        // canvas in sync with a single draw when those states settle.
        if (!this._seekHook) {
          this._seekHook = () => { if (this.active) this._draw() }
          this.video.addEventListener('seeked', this._seekHook)
          this.video.addEventListener('loadeddata', this._seekHook)
        }
      } else {
        this._frameCb = requestAnimationFrame(() => { this._draw(); next() })
      }
    }

    _draw() {
      const v = this.video, gl = this.gl
      if (!gl || v.readyState < 2 || !v.videoWidth) return
      if (this.canvas.width !== v.videoWidth || this.canvas.height !== v.videoHeight) {
        this.canvas.width  = v.videoWidth
        this.canvas.height = v.videoHeight
        gl.viewport(0, 0, v.videoWidth, v.videoHeight)
      }
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v)
      } catch (err) {
        this._fail(err.message)   // e.g. SecurityError on a cross-origin source
        return
      }
      gl.uniform1f(this.u.hlg, this.transfer === 'hlg' ? 1 : 0)
      gl.uniform1f(this.u.peak, this.peak)
      gl.uniform1f(this.u.exposure, this.exposure)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      this._sanityCheck()
    }

    // Some TV browsers play video on a hardware overlay and hand WebGL a black
    // texture. For the first ~30 s, compare against a 2D-canvas snapshot: if the
    // 2D copy has picture and ours is black, give up and show the video directly.
    _sanityCheck() {
      if (this._checks > 30 || this.video.paused) return
      const now = performance.now()
      if (this._lastCheck && now - this._lastCheck < 1000) return
      this._lastCheck = now
      this._checks++
      // One read of the middle row (a single GPU sync instead of several).
      const gl = this.gl
      const w  = this.canvas.width
      const px = new Uint8Array(w * 4)
      gl.readPixels(0, Math.floor(this.canvas.height / 2), w, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      let glLit = 0
      for (let i = 0; i < px.length; i += 16) glLit += px[i] + px[i + 1] + px[i + 2]
      if (glLit > w / 4 * 3) { this._blankHits = 0; return }
      let refLit = 0
      try {
        const c = this._ref || (this._ref = document.createElement('canvas'))
        c.width = 16; c.height = 9
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(this.video, 0, 0, 16, 9)
        const d = ctx.getImageData(0, 0, 16, 9).data
        for (let i = 0; i < d.length; i += 4) refLit += d[i] + d[i + 1] + d[i + 2]
      } catch { return }
      if (refLit > 16 * 9 * 12) {
        if (++this._blankHits >= 3) this._fail('WebGL vrací černý obraz')
      } else {
        this._blankHits = 0
      }
    }
  }

  window.HdrRenderer = HdrRenderer
})()
