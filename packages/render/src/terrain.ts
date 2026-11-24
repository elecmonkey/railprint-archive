import type { Theme } from '@railprint/style';
import { CONIC, createProjection, type View } from './projection.ts';

/**
 * Terrain layer drawn with WebGL: every pixel is inverse-projected to
 * longitude/latitude in the fragment shader and looked up in equirectangular
 * terrain textures (see packages/basemap). The inverse projections mirror
 * d3-geo exactly, so the layer lines up with the Canvas 2D layers drawn
 * through d3.
 */

/** Grid of a terrain texture, as written to data/release/basemap/terrain.json. */
export interface TerrainGrid {
  width: number;
  height: number;
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface TerrainTexture {
  grid: TerrainGrid;
  image: TexImageSource;
}

const DEG = Math.PI / 180;
const HALF_PI = Math.PI / 2;

/** n and F of d3's conic conformal raw projection for the standard parallels. */
export function conicConstants(parallels = CONIC.parallels): {
  n: number;
  f: number;
} {
  const y0 = parallels[0] * DEG;
  const y1 = parallels[1] * DEG;
  const tany = (y: number) => Math.tan((HALF_PI + y) / 2);
  const cy0 = Math.cos(y0);
  const n =
    y0 === y1
      ? Math.sin(y0)
      : Math.log(cy0 / Math.cos(y1)) / Math.log(tany(y1) / tany(y0));
  const f = (cy0 * Math.pow(tany(y0), n)) / n;
  return { n, f };
}

/**
 * Screen point (CSS pixels) to [lon, lat] in degrees, or undefined outside
 * the projection. The CPU twin of the shader, used for tests and exports.
 */
export function invertPoint(
  view: View,
  width: number,
  height: number,
  sx: number,
  sy: number,
): [number, number] | undefined {
  const projection = createProjection(view, width, height);
  const k = projection.scale();
  const [tx, ty] = projection.translate();
  const x = (sx - tx) / k;
  const y = (ty - sy) / k;
  if (view.kind === 'globe') {
    const z = Math.hypot(x, y);
    if (z > 1) return undefined;
    const c = Math.asin(z);
    const sc = Math.sin(c);
    const cc = Math.cos(c);
    const lambda = Math.atan2(x * sc, z * cc);
    const phi = Math.asin(z ? (y * sc) / z : 0);
    // Undo the rotation [-lon0, -lat0].
    const dPhi = -view.center[1] * DEG;
    const cosPhi = Math.cos(phi);
    const px = Math.cos(lambda) * cosPhi;
    const py = Math.sin(lambda) * cosPhi;
    const pz = Math.sin(phi);
    const lon =
      Math.atan2(py, px * Math.cos(dPhi) + pz * Math.sin(dPhi)) / DEG +
      view.center[0];
    const lat =
      Math.asin(
        Math.max(-1, Math.min(1, pz * Math.cos(dPhi) - px * Math.sin(dPhi))),
      ) / DEG;
    return [((((lon + 180) % 360) + 360) % 360) - 180, lat];
  }
  const { n, f } = conicConstants();
  const fy = f - y;
  const r = Math.sign(n) * Math.hypot(x, fy);
  let l = Math.atan2(x, Math.abs(fy)) * Math.sign(fy);
  if (fy * n < 0) l -= Math.PI * Math.sign(x) * Math.sign(fy);
  const lon = l / n / DEG + CONIC.meridian;
  const lat = (2 * Math.atan(Math.pow(f / r, 1 / n)) - HALF_PI) / DEG;
  return [((((lon + 180) % 360) + 360) % 360) - 180, lat];
}

const VERTEX = `#version 300 es
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;

/**
 * Regional textures the shader can blend over the global one. Each is drawn
 * over the previous ones, fading in over half a degree inside its edges, so
 * neighbouring textures that overlap by at least that much join seamlessly.
 */
export const MAX_REGIONAL = 4;

const REGIONAL_UNIFORMS = Array.from(
  { length: MAX_REGIONAL },
  (_, i) =>
    `uniform sampler2D u_regional${i};\nuniform vec4 u_regionalBox${i};`,
).join('\n');

const REGIONAL_BLEND = Array.from(
  { length: MAX_REGIONAL },
  (_, i) => `  if (u_regionalCount > ${i}) {
    vec4 b = u_regionalBox${i};
    float edge = min(min(deg.x - b.x, b.z - deg.x), min(deg.y - b.y, b.w - deg.y));
    float w = clamp(edge / 0.5, 0.0, 1.0);
    if (w > 0.0) t = mix(t, texture(u_regional${i}, uv(b, deg)).rgb, w);
  }`,
).join('\n');

const FRAGMENT = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 u_size;          // CSS pixels
uniform float u_ratio;        // device pixel ratio
uniform int u_kind;           // 0 globe, 1 conic
uniform float u_k;            // d3 scale
uniform vec2 u_translate;     // d3 translate
uniform vec2 u_center;        // globe centre, radians
uniform float u_n;            // conic n
uniform float u_f;            // conic F
uniform float u_meridian;     // conic central meridian, radians

uniform sampler2D u_global;
uniform vec4 u_globalBox;     // west, south, east, north (degrees)
${REGIONAL_UNIFORMS}
uniform int u_regionalCount;

uniform vec3 u_sea;
uniform vec3 u_landLow;
uniform vec3 u_landHigh;
uniform float u_shade;
uniform float u_seaShade;
uniform float u_flatShade;

const float PI = 3.141592653589793;
const float HALF_PI = 1.5707963267948966;

bool invert(vec2 s, out vec2 lonlat) {
  float x = (s.x - u_translate.x) / u_k;
  float y = (u_translate.y - s.y) / u_k;
  if (u_kind == 0) {
    float z = length(vec2(x, y));
    if (z > 1.0) return false;
    float c = asin(z);
    float sc = sin(c);
    float cc = cos(c);
    float lambda = atan(x * sc, z * cc);
    float phi = asin(z > 0.0 ? y * sc / z : 0.0);
    float dPhi = -u_center.y;
    float cosPhi = cos(phi);
    vec3 p = vec3(cos(lambda) * cosPhi, sin(lambda) * cosPhi, sin(phi));
    float lon = atan(p.y, p.x * cos(dPhi) + p.z * sin(dPhi)) + u_center.x;
    float lat = asin(clamp(p.z * cos(dPhi) - p.x * sin(dPhi), -1.0, 1.0));
    lonlat = vec2(lon, lat);
    return true;
  }
  float fy = u_f - y;
  float r = sign(u_n) * length(vec2(x, fy));
  float l = atan(x, abs(fy)) * sign(fy);
  if (fy * u_n < 0.0) l -= PI * sign(x) * sign(fy);
  lonlat = vec2(l / u_n + u_meridian, 2.0 * atan(pow(u_f / r, 1.0 / u_n)) - HALF_PI);
  return true;
}

vec2 uv(vec4 box, vec2 deg) {
  return vec2((deg.x - box.x) / (box.z - box.x), (box.w - deg.y) / (box.w - box.y));
}

void main() {
  vec2 s = vec2(gl_FragCoord.x, u_size.y * u_ratio - gl_FragCoord.y) / u_ratio;
  vec2 lonlat;
  if (!invert(s, lonlat)) { outColor = vec4(0.0); return; }
  vec2 deg = lonlat * (180.0 / PI);
  deg.x = mod(deg.x + 180.0, 360.0) - 180.0;

  vec3 t = texture(u_global, uv(u_globalBox, deg)).rgb;
${REGIONAL_BLEND}
  float relief = t.r / u_flatShade;            // 1 on flat ground
  float elevation = t.g * t.g;                 // undo the sqrt encoding
  float land = t.b;

  vec3 ground = mix(u_landLow, u_landHigh, smoothstep(0.0, 0.7, elevation));
  ground *= mix(1.0, relief, u_shade);
  vec3 sea = u_sea * mix(1.0, relief, u_seaShade);
  outColor = vec4(mix(sea, ground, land), 1.0);
}`;

function hex(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) throw new Error(`Expected #rrggbb, got ${color}`);
  return [
    parseInt(m[1]!, 16) / 255,
    parseInt(m[2]!, 16) / 255,
    parseInt(m[3]!, 16) / 255,
  ];
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(
      `Terrain shader: ${gl.getShaderInfoLog(shader) ?? 'compile failed'}`,
    );
  }
  return shader;
}

/** Draws the terrain layer into a WebGL2 canvas. */
export class TerrainRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private global?: { texture: WebGLTexture; grid: TerrainGrid };
  private regional: { texture: WebGLTexture; grid: TerrainGrid }[] = [];
  /** Uploaded textures by image, so setting the same image again is free. */
  private readonly uploaded = new Map<TexImageSource, WebGLTexture>();
  readonly maxTextureSize: number;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        `Terrain program: ${gl.getProgramInfoLog(program) ?? 'link failed'}`,
      );
    }
    this.program = program;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // One triangle covering the viewport.
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  }

  private uniform(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name))
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }

  private upload(image: TexImageSource, wrap: boolean): WebGLTexture {
    const cached = this.uploaded.get(image);
    if (cached) return cached;
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // The channels are data, not colours: no colour management or premultiplying.
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_WRAP_S,
      wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.uploaded.set(image, texture);
    return texture;
  }

  /**
   * Set the global texture and sharper regional ones, drawn in order over it.
   * Regional textures the device cannot hold are skipped, as are any beyond
   * MAX_REGIONAL.
   */
  setTextures(global: TerrainTexture, regional: TerrainTexture[] = []): void {
    // The global texture wraps around the globe; regional ones do not.
    this.global = {
      texture: this.upload(global.image, true),
      grid: global.grid,
    };
    this.regional = regional
      .filter(
        (r) => Math.max(r.grid.width, r.grid.height) <= this.maxTextureSize,
      )
      .slice(0, MAX_REGIONAL)
      .map((r) => ({ texture: this.upload(r.image, false), grid: r.grid }));
  }

  get ready(): boolean {
    return Boolean(this.global);
  }

  /** Draw at `ratio` device pixels per CSS pixel; the canvas must already be sized. */
  draw(
    view: View,
    width: number,
    height: number,
    ratio: number,
    theme: Theme,
  ): void {
    const gl = this.gl;
    gl.viewport(0, 0, Math.round(width * ratio), Math.round(height * ratio));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.global) return;
    gl.useProgram(this.program);

    const projection = createProjection(view, width, height);
    const { n, f } = conicConstants();
    gl.uniform2f(this.uniform('u_size'), width, height);
    gl.uniform1f(this.uniform('u_ratio'), ratio);
    gl.uniform1i(this.uniform('u_kind'), view.kind === 'globe' ? 0 : 1);
    gl.uniform1f(this.uniform('u_k'), projection.scale());
    gl.uniform2f(this.uniform('u_translate'), ...projection.translate());
    gl.uniform2f(
      this.uniform('u_center'),
      view.center[0] * DEG,
      view.center[1] * DEG,
    );
    gl.uniform1f(this.uniform('u_n'), n);
    gl.uniform1f(this.uniform('u_f'), f);
    gl.uniform1f(this.uniform('u_meridian'), CONIC.meridian * DEG);

    const box = (g: TerrainGrid) => [g.west, g.south, g.east, g.north] as const;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.global.texture);
    gl.uniform1i(this.uniform('u_global'), 0);
    gl.uniform4f(this.uniform('u_globalBox'), ...box(this.global.grid));
    gl.uniform1i(this.uniform('u_regionalCount'), this.regional.length);
    this.regional.forEach(({ texture, grid }, i) => {
      gl.activeTexture(gl.TEXTURE1 + i);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(this.uniform(`u_regional${i}`), 1 + i);
      gl.uniform4f(this.uniform(`u_regionalBox${i}`), ...box(grid));
    });

    const t = theme.terrain;
    gl.uniform3f(this.uniform('u_sea'), ...hex(theme.sea));
    gl.uniform3f(this.uniform('u_landLow'), ...hex(t.landLow));
    gl.uniform3f(this.uniform('u_landHigh'), ...hex(t.landHigh));
    gl.uniform1f(this.uniform('u_shade'), t.shade);
    gl.uniform1f(this.uniform('u_seaShade'), t.seaShade);
    gl.uniform1f(this.uniform('u_flatShade'), Math.cos(Math.PI / 4));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
