/* ANTROR Code — keeps the address bar clean on the live site.
   On hosts with clean URLs (Vercel), .html links are rewritten to /page;
   plain local servers keep working with .html unchanged. */
'use strict';
(function(){
  if(location.hostname==='localhost' || location.hostname==='127.0.0.1' || location.protocol==='file:') return;
  document.addEventListener('click',function(e){
    const a=e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if(!a) return;
    const h=a.getAttribute('href')||'';
    if(h.endsWith('.html') && !h.startsWith('http') && !h.startsWith('//')){
      e.preventDefault();
      location.href='/'+h.slice(0,-5);
    }
  },true);
})();
