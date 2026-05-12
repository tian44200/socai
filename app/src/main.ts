// Inline the brand mark so it picks up `currentColor` from its container.
// Source: design system v1, assets/socai-mark.svg.
const MARK_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="48" height="48" fill="none" role="img" aria-label="socai">
    <rect x="2.5" y="2.5" width="27" height="27" rx="3" stroke="currentColor" stroke-width="1.6"></rect>
    <rect x="16" y="16" width="10" height="10" rx="1.2" fill="currentColor"></rect>
  </svg>
`;

function main(): void {
  const root = document.getElementById("app");
  if (!root) return;
  root.innerHTML = `
    <main class="hero">
      <div class="hero-mark">${MARK_SVG}</div>
      <h1 class="t-display">socai</h1>
      <p class="t-lede">The web-use agent.</p>
    </main>
  `;
}

main();
