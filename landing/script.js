/* ========================================================================
   Quipu Landing Page — script.js
   ======================================================================== */

(function () {
  'use strict';

  // --- Intersection Observer for fade-in animations ---
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );

  document.querySelectorAll('.anim-fade-up').forEach((el) => {
    observer.observe(el);
  });

  // --- Mobile nav toggle ---
  const mobileToggle = document.getElementById('mobile-toggle');
  const navLinks = document.getElementById('nav-links');

  if (mobileToggle && navLinks) {
    mobileToggle.addEventListener('click', () => {
      mobileToggle.classList.toggle('open');
      navLinks.classList.toggle('open');
    });

    // Close mobile nav on link click
    navLinks.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        mobileToggle.classList.remove('open');
        navLinks.classList.remove('open');
      });
    });
  }

  // --- Theme toggle ---
  const themeToggle = document.getElementById('theme-toggle');
  const root = document.documentElement;

  // Load saved theme
  const saved = localStorage.getItem('quipu-landing-theme');
  if (saved === 'dark') {
    root.classList.add('dark');
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      root.classList.toggle('dark');
      localStorage.setItem(
        'quipu-landing-theme',
        root.classList.contains('dark') ? 'dark' : 'light'
      );
    });
  }

  // --- Typing animation in terminal mockup ---
  const typedCmd = document.getElementById('typed-cmd');
  const termCursor = document.getElementById('term-cursor');

  if (typedCmd) {
    const commands = [
      'npm run dev',
      'git commit -m "ship landing page"',
      'claude "review my code"',
      'npm run build',
      'go run server/main.go',
    ];

    let cmdIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    let isPaused = false;

    function typeLoop() {
      const current = commands[cmdIndex];

      if (isPaused) {
        isPaused = false;
        isDeleting = true;
        setTimeout(typeLoop, 40);
        return;
      }

      if (!isDeleting) {
        // Typing forward
        typedCmd.textContent = current.substring(0, charIndex + 1);
        charIndex++;

        if (charIndex >= current.length) {
          // Pause at end of command
          isPaused = true;
          setTimeout(typeLoop, 2000);
          return;
        }

        setTimeout(typeLoop, 50 + Math.random() * 40);
      } else {
        // Deleting
        typedCmd.textContent = current.substring(0, charIndex);
        charIndex--;

        if (charIndex < 0) {
          isDeleting = false;
          charIndex = 0;
          cmdIndex = (cmdIndex + 1) % commands.length;
          setTimeout(typeLoop, 400);
          return;
        }

        setTimeout(typeLoop, 25);
      }
    }

    // Start typing after mockup is visible
    const mockup = document.getElementById('editor-mockup');
    if (mockup) {
      const typingObserver = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            setTimeout(typeLoop, 800);
            typingObserver.unobserve(mockup);
          }
        },
        { threshold: 0.3 }
      );
      typingObserver.observe(mockup);
    }
  }

  // --- Smooth scroll for anchor links ---
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const offset = parseInt(
          getComputedStyle(document.documentElement).getPropertyValue('--nav-height'),
          10
        ) || 64;
        const top = target.getBoundingClientRect().top + window.scrollY - offset - 16;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  // --- Nav background on scroll ---
  const nav = document.getElementById('nav');
  if (nav) {
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          nav.classList.toggle('scrolled', window.scrollY > 10);
          ticking = false;
        });
        ticking = true;
      }
    });
  }
})();
