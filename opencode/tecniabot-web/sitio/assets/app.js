// Tecnia Bot — micro-sitio. Terminal que teclea + copiar ejemplos. Offline, sin deps.

// Terminal que teclea sola (si existe en la página).
(function(){
  const el = document.getElementById('typed');
  if(!el) return;
  const frases = [
    "dibujame el circuito de un servo con ESP32",
    "quiero armar el semáforo paso a paso",
    "abrí el monitor serial",
    "¿cómo funciona un LED con Arduino?",
    "dame los materiales del semáforo para imprimir",
  ];
  let fi=0, ci=0, borrando=false;
  function tick(){
    const f = frases[fi];
    if(!borrando){
      el.textContent = f.slice(0, ++ci);
      if(ci >= f.length){ borrando=true; return setTimeout(tick, 1700); }
      return setTimeout(tick, 48 + (Math.floor(ci/6)%2 ? 22 : 0));
    }
    el.textContent = f.slice(0, --ci);
    if(ci <= 0){ borrando=false; fi=(fi+1)%frases.length; return setTimeout(tick, 380); }
    return setTimeout(tick, 26);
  }
  tick();
})();

// Los ojos del robot siguen el mouse (un guiño de vida).
(function(){
  const ojos = document.getElementById('ojos');
  const robot = document.querySelector('.robot');
  if(!ojos || !robot) return;
  const clamp = (v)=> Math.max(-1, Math.min(1, v));
  window.addEventListener('mousemove', (e)=>{
    const r = robot.getBoundingClientRect();
    const dx = clamp((e.clientX - (r.left + r.width/2)) / (window.innerWidth/2));
    const dy = clamp((e.clientY - (r.top + r.height/2)) / (window.innerHeight/2));
    ojos.setAttribute('transform', `translate(${dx*11} ${dy*8})`);
  }, { passive:true });
})();

// Glow que sigue al cursor dentro de cada tarjeta.
(function(){
  document.querySelectorAll('.ej .item, .proj').forEach(c=>{
    c.addEventListener('mousemove', (e)=>{
      const r = c.getBoundingClientRect();
      c.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
      c.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
    }, { passive:true });
  });
})();

// Click en un ejemplo → copiar el prompt (con fallback para file://).
(function(){
  function copiar(texto){
    if(navigator.clipboard && window.isSecureContext){
      return navigator.clipboard.writeText(texto).catch(()=>fallback(texto));
    }
    return Promise.resolve(fallback(texto));
  }
  function fallback(texto){
    const ta=document.createElement('textarea'); ta.value=texto; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); }catch(e){}
    document.body.removeChild(ta);
  }
  document.querySelectorAll('.prompt').forEach(p=>{
    p.addEventListener('click', ()=>{
      copiar(p.dataset.p || p.textContent);
      p.classList.add('copiado');
      setTimeout(()=>p.classList.remove('copiado'), 1400);
    });
  });
})();
