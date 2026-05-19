'use strict';

/**
 * Full House Horse Sale — Splash Screen (Homepage Only)
 * 
 * Flow: white screen → fade in video → play → fade out quickly to loaded page
 * Runs on every page load/reload. Does NOT affect login/session state.
 */

(function() {
  // Create splash overlay
  const overlay = document.createElement('div');
  overlay.id = 'splash-overlay';
  overlay.innerHTML = `
    <video id="splash-video" muted playsinline preload="auto"
           style="opacity:0; width:100%; height:100%; object-fit:contain; transition: opacity 0.4s ease;">
      <source src="/splash.mp4" type="video/mp4">
    </video>
  `;

  // Style the overlay
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '99999',
    background: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'opacity 0.5s ease',
    opacity: '1'
  });

  // Hide page content behind the white overlay
  const style = document.createElement('style');
  style.id = 'splash-styles';
  style.textContent = `
    body > *:not(#splash-overlay):not(#splash-styles):not(script):not(style):not(link):not(.modal-overlay):not(.sold-overlay):not([id$="-modal"]):not([id$="-overlay"]) {
      opacity: 0 !important;
      transition: opacity 0.5s ease !important;
    }
  `;
  document.head.appendChild(style);

  // Insert overlay as first child of body
  if (document.body) {
    document.body.prepend(overlay);
  } else {
    document.addEventListener('DOMContentLoaded', () => document.body.prepend(overlay));
  }

  const video = overlay.querySelector('#splash-video');

  // When video can play, fade it in and start
  video.addEventListener('canplaythrough', startSplash, { once: true });
  // Fallback: if canplaythrough doesn't fire within 2s, start anyway
  const fallbackTimer = setTimeout(() => {
    startSplash();
  }, 2000);

  let started = false;
  function startSplash() {
    if (started) return;
    started = true;
    clearTimeout(fallbackTimer);

    // Small delay then fade in video
    setTimeout(() => {
      video.style.opacity = '1';
      video.play().catch(() => {
        revealPage();
      });
    }, 200);
  }

  // When video ends, quickly fade overlay away to reveal loaded page
  video.addEventListener('ended', () => {
    // Immediately start fading the whole overlay (video + white bg)
    overlay.style.opacity = '0';

    // Simultaneously fade in the page content
    const children = Array.from(document.body.children).filter(el => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'link') return false;
      if (el.id === 'splash-overlay' || el.id === 'splash-styles') return false;
      if (el.classList.contains('modal-overlay')) return false;
      if (el.classList.contains('sold-overlay')) return false;
      if (el.id && (el.id.endsWith('-modal') || el.id.endsWith('-overlay'))) return false;
      return true;
    });

    children.forEach(el => {
      el.style.opacity = '1';
    });

    // Clean up after fade completes
    setTimeout(() => {
      overlay.remove();
      children.forEach(el => {
        el.style.opacity = '';
        el.style.transition = '';
      });
      const splashStyle = document.getElementById('splash-styles');
      if (splashStyle) splashStyle.remove();
    }, 600);
  });

  function revealPage() {
    overlay.style.opacity = '0';
    const children = Array.from(document.body.children).filter(el => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'link') return false;
      if (el.id === 'splash-overlay' || el.id === 'splash-styles') return false;
      if (el.classList.contains('modal-overlay')) return false;
      if (el.classList.contains('sold-overlay')) return false;
      if (el.id && (el.id.endsWith('-modal') || el.id.endsWith('-overlay'))) return false;
      return true;
    });
    children.forEach(el => { el.style.opacity = '1'; });
    setTimeout(() => {
      overlay.remove();
      children.forEach(el => { el.style.opacity = ''; el.style.transition = ''; });
      const splashStyle = document.getElementById('splash-styles');
      if (splashStyle) splashStyle.remove();
    }, 600);
  }
})();
