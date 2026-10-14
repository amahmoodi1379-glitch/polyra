"use client";

import { useEffect, useRef } from "react";
import { reducedMotion } from "./motion";
import { buzz, sfx } from "./sfx";

/**
 * The start button (DESIGN.md, «The jelly»): a WebGL body that breathes, squashes under the finger,
 * ripples from the touch point and leans toward the pointer, with the wordmark riding on it. Without
 * WebGL a CSS blob stands in; under reduced motion it is drawn once and stays still. Ported from
 * `design/prototypes/polyra-jelly.html`.
 */

const FS = `precision highp float;
uniform vec2 res; uniform float t; uniform float sq; uniform vec2 tp; uniform float rip; uniform vec2 m; uniform float lift;
uniform vec3 cA; uniform vec3 cB; uniform vec3 cC; uniform vec3 cT; uniform float dark;
float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float sdf(vec2 p){
 vec2 q=p; q.x/=1.+.17*sq; q.y/=1.-.2*sq; q.y+=.1*sq;
 float a=atan(q.y,q.x), r=length(q);
 float w=.034*sin(2.*a+t*.95)+.026*sin(3.*a-t*1.15+1.3)+.008*sin(5.*a+t*1.7);
 float rd=length(p-tp);
 w+=.045*exp(-rip*2.6)*sin(rd*20.-rip*16.)*exp(-rd*1.6);
 w+=.06*max(0.,dot(q/(r+1e-4),m));
 float d=r-(.6+w)*lift;
 vec2 s1=vec2(cos(t*.62),sin(t*.81))*.5*lift, s2=vec2(cos(t*.47+2.6),sin(t*.58+2.))*.48*lift;
 d=smin(d,length(q-s1)-.19*lift,.3);
 d=smin(d,length(q-s2)-.16*lift,.28);
 return d;
}
float H(vec2 p){float x=clamp(-sdf(p)/.42,0.,1.);return sqrt(1.-(1.-x)*(1.-x));}
void main(){
 float s=min(res.x,res.y);
 vec2 p=(gl_FragCoord.xy*2.-res)/s;
 float e=2./s;
 float d=sdf(p);
 float al=1.-smoothstep(-e,e,d);
 float sh=sdf((p-vec2(0.,-.1))*vec2(1.,1.25));
 float sa=(1.-smoothstep(-.06,.26,sh))*mix(.26,.32,dark);
 vec3 shc=mix(vec3(.31,.06,.18),cA,dark);
 if(al<.002){gl_FragColor=vec4(shc*sa,sa);return;}
 float hx=H(p+vec2(e*1.5,0.))-H(p-vec2(e*1.5,0.)), hy=H(p+vec2(0.,e*1.5))-H(p-vec2(0.,e*1.5));
 vec3 n=normalize(vec3(-hx/(3.*e)*.32,-hy/(3.*e)*.32,1.));
 float x=clamp(-d/.55,0.,1.);
 float fl=.5+.5*sin(p.x*3.1+t*.85+sin(p.y*3.7-t*.6)*1.4);
 vec3 body=mix(cC,cA,smoothstep(0.,.55,x));
 body=mix(body,cB,fl*.5*smoothstep(.1,.9,x));
 vec3 L=normalize(vec3(-.42,.62,.66));
 float df=clamp(dot(n,L),0.,1.);
 body*=.74+.36*df;
 body+=cB*.22*pow(1.-x,3.)*(1.-df);
 vec3 Hh=normalize(L+vec3(0.,0.,1.));
 float sp=pow(clamp(dot(n,Hh),0.,1.),70.);
 float sp2=pow(clamp(dot(n,Hh),0.,1.),6.);
 float fr=pow(1.-n.z,2.2);
 vec3 rim=mix(cB,cT,.4+.3*sin(t*.55));
 vec3 col=body+vec3(1.)*sp*.9+vec3(1.,.85,.9)*sp2*.09+rim*fr*.42;
 col=min(col,vec3(1.));
 float a=al+sa*(1.-al);
 gl_FragColor=vec4(col*al+shc*sa*(1.-al),a);
}`;
const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";

const hex = (value: string): [number, number, number] => {
  const v = parseInt(value.trim().replace("#", ""), 16) || 0;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

type Body = {
  sq: number;
  v: number;
  target: number;
  lift: number;
  lv: number;
  liftTarget: number;
  tp: [number, number];
  pressAt: number;
  m: [number, number];
  mt: [number, number];
  last: number;
};

export type JellyMode = "launch" | "poke";

export function Jelly({ label, describedBy, mode, onActivate }: { label: string; describedBy?: string; mode: JellyMode; onActivate: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const word = useRef<HTMLSpanElement>(null);
  const body = useRef<Body>({ sq: 0, v: 0, target: 0, lift: 1, lv: 0, liftTarget: 1, tp: [9, 9], pressAt: -99, m: [0, 0], mt: [0, 0], last: 0 });
  const busy = useRef(false);
  const latest = useRef({ mode, onActivate });
  useEffect(() => {
    latest.current = { mode, onActivate };
  });

  useEffect(() => {
    const btn = button.current!;
    const cv = canvas.current!;
    const wm = word.current!;
    const st = body.current;
    const gl = cv.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true, powerPreference: "low-power" });
    if (!gl) {
      btn.classList.add("no-gl");
      return;
    }
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      btn.classList.add("no-gl");
      return;
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.clearColor(0, 0, 0, 0);
    const U = Object.fromEntries(["res", "t", "sq", "tp", "rip", "m", "lift", "cA", "cB", "cC", "cT", "dark"].map((key) => [key, gl.getUniformLocation(program, key)]));

    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.round(cv.clientWidth * dpr));
      const h = Math.max(1, Math.round(cv.clientHeight * dpr));
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
        gl.viewport(0, 0, w, h);
        gl.uniform2f(U.res, w, h);
      }
    };
    const draw = (now: number) => {
      size();
      const dt = Math.min(0.033, Math.max(0, (now - (st.last || now)) / 1000));
      st.last = now;
      const still = reducedMotion();
      if (!still) {
        st.v += (-260 * (st.sq - st.target) - 13 * st.v) * dt;
        st.sq += st.v * dt;
        st.lv += (-200 * (st.lift - st.liftTarget) - 14 * st.lv) * dt;
        st.lift += st.lv * dt;
        st.m[0] += (st.mt[0] - st.m[0]) * 0.08;
        st.m[1] += (st.mt[1] - st.m[1]) * 0.08;
      }
      const t = still ? 2.4 : now / 1000;
      gl.uniform1f(U.t, t);
      gl.uniform1f(U.sq, st.sq);
      gl.uniform1f(U.lift, st.lift);
      gl.uniform2f(U.tp, st.tp[0], st.tp[1]);
      gl.uniform1f(U.rip, still ? 9 : (now - st.pressAt) / 1000);
      gl.uniform2f(U.m, st.m[0], st.m[1]);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // The wordmark rides the same body.
      const breath = still ? 0 : 0.012 * Math.sin(t * 1.6);
      const sx = (1 + 0.17 * st.sq) * (1 + breath) * st.lift;
      const sy = (1 - 0.2 * st.sq) * (1 - breath) * st.lift;
      wm.style.transform = `translate(calc(-50% + ${(st.m[0] * 6).toFixed(2)}px), calc(-48% + ${(st.sq * 14 - st.m[1] * 6).toFixed(2)}px)) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
    };
    const readColors = () => {
      const cs = getComputedStyle(btn);
      for (const key of ["a", "b", "c", "t"]) gl.uniform3fv(U[`c${key.toUpperCase()}`], hex(cs.getPropertyValue(`--j-${key}`)));
      gl.uniform1f(U.dark, parseFloat(cs.getPropertyValue("--j-dark")) || 0);
      draw(performance.now());
    };

    const toBody = (event: PointerEvent): [number, number] => {
      const box = cv.getBoundingClientRect();
      const s = Math.min(box.width, box.height);
      return [((event.clientX - box.left) * 2 - box.width) / s, -((event.clientY - box.top) * 2 - box.height) / s];
    };
    const down = (event: PointerEvent) => {
      st.target = 1;
      st.tp = toBody(event);
      st.pressAt = performance.now();
      sfx("press", 0.45);
      buzz(6);
    };
    const release = () => {
      st.target = 0;
    };
    const move = (event: PointerEvent) => {
      const [x, y] = toBody(event);
      const l = Math.hypot(x, y) || 1;
      st.mt = l < 1.2 ? [(x / l) * Math.min(1, l), (y / l) * Math.min(1, l)] : [0, 0];
    };
    const leave = () => {
      st.mt = [0, 0];
      st.target = 0;
    };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("pointermove", move);
    btn.addEventListener("pointerleave", leave);

    let visible = true;
    const seen = new IntersectionObserver((entries) => entries.forEach((entry) => (visible = entry.isIntersecting)));
    seen.observe(cv);
    const resized = new ResizeObserver(() => draw(performance.now()));
    resized.observe(cv);
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", readColors);
    const themed = new MutationObserver(readColors);
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    document.fonts?.ready.then(() => draw(performance.now()));

    let frame = 0;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (!visible || document.hidden || reducedMotion()) return;
      draw(now);
    };
    readColors();
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      seen.disconnect();
      resized.disconnect();
      themed.disconnect();
      scheme.removeEventListener("change", readColors);
      btn.removeEventListener("pointerdown", down);
      btn.removeEventListener("pointerup", release);
      btn.removeEventListener("pointercancel", release);
      btn.removeEventListener("pointermove", move);
      btn.removeEventListener("pointerleave", leave);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  const activate = (event: React.MouseEvent) => {
    const st = body.current;
    const { mode: now, onActivate: run } = latest.current;
    // A keyboard press has no pointer: give it the same squash from the centre.
    if (event.detail === 0) {
      st.target = 1;
      st.pressAt = performance.now();
      st.tp = [0, 0];
      window.setTimeout(() => (st.target = 0), 110);
    }
    if (now === "poke") {
      sfx("droplet", 0.4);
      run();
      return;
    }
    if (busy.current) return;
    busy.current = true;
    sfx("arrival", 0.5);
    buzz(10);
    window.setTimeout(() => (st.liftTarget = 1.18), 140);
    window.setTimeout(
      () => {
        run();
        // Back to rest if the page stays (a sheet, or the browser's back button).
        window.setTimeout(() => {
          st.liftTarget = 1;
          busy.current = false;
        }, 900);
      },
      reducedMotion() ? 0 : 480,
    );
  };

  return (
    <button ref={button} className="start" type="button" aria-label={label} aria-describedby={describedBy} onClick={activate}>
      <canvas ref={canvas} aria-hidden="true" />
      <span className="blob-fallback" aria-hidden="true" />
      <span ref={word} className="wordmark" aria-hidden="true">
        polyra
      </span>
    </button>
  );
}
