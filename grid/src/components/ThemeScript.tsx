// No-flash theme bootstrap. Renders a raw inline <script> in <head> that runs
// BEFORE first paint: reads localStorage.theme (or prefers-color-scheme) and
// sets `html.dark` so there is never a light→dark flash. Must be a plain
// server-rendered script tag (not next/script, which defers).

const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function ThemeScript() {
  return (
    <script
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}
    />
  );
}
