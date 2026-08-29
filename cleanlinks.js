/* ANTROR Code — keeps the address bar clean on the live site.
   On hosts with clean URLs (Vercel), .html links are rewritten to /page;
   plain local servers keep working with .html unchanged. */
'use strict';
(function(){
  if(location.protocol==='file:') return;   // desktop app: .html files are the real paths
  document.addEventListener('click',function(e){
    const a=e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if(!a) return;
    const h=a.getAttribute('href')||'';
    if(h.endsWith('.html') && !h.startsWith('http') && !h.startsWith('//')){
      e.preventDefault();
      const clean=h==='index.html' ? '/' : '/'+h.slice(0,-5);
      location.href=clean;
    }
  },true);
})();
