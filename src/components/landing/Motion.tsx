'use client';

import { useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * Choreography for the public landing page. One entrance for the hero, one reveal per section as it scrolls into view,
 * and a connector line that draws once. Nothing loops, nothing hijacks scrolling, and with prefers-reduced-motion
 * the page is shown exactly as server-rendered. Content is never hidden by CSS unless this runs (see the .js rule).
 */
export function Motion() {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const intro = gsap.utils.toArray<HTMLElement>('[data-intro]');
      if (intro.length) {
        gsap.to(intro, {
          opacity: 1,
          y: 0,
          duration: 0.7,
          ease: 'power3.out',
          stagger: 0.09,
          onComplete: () => intro.forEach((el) => el.setAttribute('data-intro', 'done')),
        });
      }
      gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((el) => {
        gsap.from(el, { opacity: 0, y: 18, duration: 0.6, ease: 'power2.out', clearProps: 'opacity,transform', scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
      });
      gsap.utils.toArray<HTMLElement>('[data-draw]').forEach((el) => {
        gsap.from(el, { scaleX: 0, transformOrigin: 'left center', duration: 0.9, ease: 'power2.inOut', scrollTrigger: { trigger: el, start: 'top 85%', once: true } });
      });
    });
    mm.add('(prefers-reduced-motion: reduce)', () => {
      document.querySelectorAll<HTMLElement>('[data-intro]').forEach((el) => el.setAttribute('data-intro', 'done'));
    });
    return () => mm.revert();
  }, []);
  return null;
}
