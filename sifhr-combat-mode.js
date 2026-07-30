/* ============================================================
   SIFHR — MODE COMBAT v2 (intégration profonde)
   ------------------------------------------------------------
   Contrairement à la v1, ce module ne tente plus de dupliquer
   ou de contourner le lanceur existant : il pilote le VRAI
   lanceur (openDice, dSelectAptitude, successVal1/2, dRollDice…)
   avec les vraies données du personnage (state.aptitudes,
   state.equipement, state.tokens). Aucune fonction existante
   n'est réécrite — seule dShowAdversaireResult est enveloppée
   (original appelé en premier, notre résolution ensuite).

   Installation : <script src="sifhr-combat-mode.js"></script>
   juste avant </body>, + sifhr_armes_manoeuvres.json dans le
   même dossier.
   ============================================================ */
(function(){
  'use strict';
  console.log('[sifhr-combat-mode] script chargé et exécuté ✓');

  // ── 1. Catalogue ──
  let CATALOGUE = null;
  async function chargerCatalogue(){
    if(CATALOGUE) return CATALOGUE;
    try{
      const r = await fetch(getBaseUrl()+'sifhr_armes_manoeuvres.json');
      CATALOGUE = await r.json();
    }catch(e){
      console.error('[combat-mode] catalogue non chargé', e);
      CATALOGUE = {armes:[], manoeuvres:[]};
    }
    return CATALOGUE;
  }

  // Segment → index de couple (1-2 / 3-4 / 5-6 / 7-8)
  const SEGMENT_TO_COUPLE = {
    'feu':0,'bile jaune':0, 'terre':1,'bile noire':1,
    'eau':2,'flegme':2, 'air':3,'sang':3
  };
  const COUPLES = [[1,2],[3,4],[5,6],[7,8]];

  // Label français → clé Aptitude (APTITUDE_KEYS)
  const LABEL_TO_APTKEY = {
    'se déplacer':'se_deplacer','se mesurer':'se_mesurer','occulter':'occulter',
    'dévoiler':'devoiler','résister':'resister','ravir':'ravir',
    'imaginer':'imaginer','fabriquer':'fabriquer'
  };

  function parsePrerequis(str){
    // "Se Mesurer N2, Feu N1" -> {aptKey:'se_mesurer', niveau:2, reste:'Feu N1'}
    if(!str) return null;
    const first = str.split(',')[0].trim();
    const m = first.match(/^(.+?)\s+N(\d)/i);
    if(!m) return null;
    const label = m[1].trim().toLowerCase();
    const aptKey = LABEL_TO_APTKEY[label];
    if(!aptKey) return null;
    return {aptKey, niveau: parseInt(m[2])};
  }

  function parseOctogoneSegment(str){
    if(!str) return null;
    const seg = str.split(':')[0].trim().toLowerCase();
    return SEGMENT_TO_COUPLE[seg] !== undefined ? seg : null;
  }

  // ── 1bis. Collection personnelle de manœuvres (state.manoeuvresCombat) ──
  function ensureManoeuvresState(){
    // `state` est déclaré avec `let` au premier niveau d'octogone.html : il est
    // accessible comme identifiant partagé entre <script> de la page, MAIS PAS
    // via window.state (les déclarations let/const top-level n'atterrissent pas
    // sur window). D'où la vérification par typeof plutôt que window.state.
    if(typeof state==='undefined' || !state) return [];
    if(!Array.isArray(state.manoeuvresCombat)) state.manoeuvresCombat = [];
    return state.manoeuvresCombat;
  }
  function nouvelIdManoeuvre(){
    return 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  }

  // Actions disponibles pour CE personnage = sa collection personnelle uniquement
  // (et non plus l'intégralité du catalogue partagé).
  function getActions(){
    return ensureManoeuvresState().map(m=>({...m, _typeAction:'perso'}));
  }

  // ── 1ter. Éditeur de la collection personnelle (panneau de fiche) ──
  function installerPanneauEditeur(){
    const hote = document.querySelector('.lower-wide');
    if(!hote){ setTimeout(installerPanneauEditeur, 500); return; }
    let wrap = document.getElementById('combat-editeur-wrap');
    if(!wrap){
      wrap = document.createElement('div');
      wrap.className = 'panel';
      wrap.innerHTML = `
        <div class="panel-title" id="combat-editeur-title" data-target="combat-editeur-panel">Manœuvres de combat</div>
        <div class="panel-body collapsed" id="combat-editeur-panel">
          <div class="panel-body-inner" id="combat-editeur-wrap"></div>
        </div>`;
      hote.appendChild(wrap);
      const titleEl = document.getElementById('combat-editeur-title');
      titleEl.classList.add('collapsed');
      titleEl.addEventListener('click', ()=>{
        if(typeof toggleAccordion==='function') toggleAccordion(titleEl);
      });
      wrap = document.getElementById('combat-editeur-wrap');
    }
    renderListeManoeuvres(wrap);
  }

  function renderListeManoeuvres(wrap){
    const liste = ensureManoeuvresState();
    let html = `<div style="display:flex;gap:.4rem;margin-bottom:.6rem;flex-wrap:wrap;">
      <button id="combat-nouvelle-btn" class="combat-editor-btn" style="${btnStyle('#8b2020')}">+ Nouvelle manœuvre</button>
      <button id="combat-biblio-btn" class="combat-editor-btn" style="${btnStyle('#185FA5')}">📚 Depuis la bibliothèque</button>
    </div>`;
    if(!liste.length){
      html += `<div style="font-size:.82rem;font-style:italic;color:var(--ink3,#666);">Aucune manœuvre pour l'instant.</div>`;
    } else {
      html += liste.map(m=>`
        <div class="combat-man-card" data-id="${m.id}" style="border:1px solid var(--border,#b8a88a);border-radius:6px;padding:.5rem .7rem;margin-bottom:.4rem;background:var(--input-bg,#faf7f0);">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="font-family:'Cinzel',serif;font-size:.82rem;">${m.nom}</strong>
            <span>
              <button class="combat-edit-btn" data-id="${m.id}" style="${btnStyle('#7a5200',true)}">✎</button>
              <button class="combat-del-btn" data-id="${m.id}" style="${btnStyle('#8b2020',true)}">🗑</button>
            </span>
          </div>
          <div style="font-size:.78rem;color:var(--ink3,#666);margin-top:.2rem;">
            ${m.aptitude?(APT_LABELS[m.aptitude]||m.aptitude)+' N'+(m.niveauRequis||0):'Aucune Aptitude requise'}
            ${m.segmentOctogone?' · Segment '+m.segmentOctogone:''}
            ${m.armeAssociee?' · Arme : '+m.armeAssociee:(m.nonArme?' · Sans arme':'')}
          </div>
          ${m.effet?`<div style="font-size:.8rem;margin-top:.3rem;">${m.effet}</div>`:''}
        </div>`).join('');
    }
    html += `<div id="combat-form-zone"></div>`;
    wrap.innerHTML = html;
    document.getElementById('combat-nouvelle-btn').addEventListener('click', ()=>ouvrirFormulaire(null));
    document.getElementById('combat-biblio-btn').addEventListener('click', ouvrirBibliotheque);
    wrap.querySelectorAll('.combat-edit-btn').forEach(b=>b.addEventListener('click',()=>ouvrirFormulaire(b.dataset.id)));
    wrap.querySelectorAll('.combat-del-btn').forEach(b=>b.addEventListener('click',()=>supprimerManoeuvre(b.dataset.id)));
  }

  function btnStyle(color, small){
    return `font-family:'Cinzel',serif;font-size:${small?'.68rem':'.72rem'};padding:${small?'2px 7px':'5px 12px'};`
      +`border-radius:5px;border:1px solid ${color};background:${color};color:#fff;cursor:pointer;`;
  }

  function supprimerManoeuvre(id){
    if(!confirm('Supprimer cette manœuvre de votre collection ?')) return;
    const liste = ensureManoeuvresState();
    const idx = liste.findIndex(m=>m.id===id);
    if(idx!==-1) liste.splice(idx,1);
    if(typeof saveState==='function') saveState();
    installerPanneauEditeur();
    rafraichirGrilleCombatSiOuverte();
  }

  function ouvrirFormulaire(id, prefill){
    const zone = document.getElementById('combat-form-zone');
    if(!zone) return;
    const existant = id ? ensureManoeuvresState().find(m=>m.id===id) : null;
    const data = existant || prefill || {nom:'',aptitude:'',niveauRequis:0,segmentOctogone:'',armeAssociee:'',nonArme:false,effet:'',notes:'',ctp:null};
    const aptOptions = ['<option value="">— Aucune —</option>']
      .concat(APTITUDE_KEYS.map(k=>`<option value="${k}" ${data.aptitude===k?'selected':''}>${APT_LABELS[k]}</option>`)).join('');
    const segOptions = ['<option value="">— Aucun —</option>']
      .concat(SECTORS.map(s=>`<option value="${s.id}" ${data.segmentOctogone===s.id?'selected':''}>${s.label}</option>`)).join('');
    zone.innerHTML = `
      <div style="border:2px solid #8b2020;border-radius:7px;padding:.7rem;margin-top:.5rem;background:#fff8f0;">
        <div style="font-family:'Cinzel',serif;font-size:.78rem;color:#8b2020;margin-bottom:.5rem;">${existant?'Modifier':'Nouvelle'} manœuvre</div>
        <input type="text" id="cf-nom" placeholder="Nom de la manœuvre" value="${(data.nom||'').replace(/"/g,'&quot;')}" style="width:100%;margin-bottom:.4rem;padding:.3rem;">
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.4rem;">
          <select id="cf-apt" style="flex:1;">${aptOptions}</select>
          <input type="number" id="cf-niveau" min="0" max="6" value="${data.niveauRequis||0}" style="width:70px;" title="Niveau d'Aptitude requis">
          <select id="cf-segment" style="flex:1;">${segOptions}</select>
        </div>
        <div style="display:flex;gap:.4rem;align-items:center;margin-bottom:.4rem;flex-wrap:wrap;">
          <input type="text" id="cf-arme" placeholder="Arme associée (facultatif)" value="${(data.armeAssociee||'').replace(/"/g,'&quot;')}" style="flex:1;padding:.3rem;" ${data.nonArme?'disabled':''}>
          <label style="font-size:.75rem;"><input type="checkbox" id="cf-nonarme" ${data.nonArme?'checked':''}> Sans arme</label>
        </div>
        <textarea id="cf-effet" placeholder="Effet (par palier si pertinent)" style="width:100%;min-height:50px;margin-bottom:.4rem;padding:.3rem;">${data.effet||''}</textarea>
        <textarea id="cf-notes" placeholder="Notes / source (facultatif)" style="width:100%;min-height:34px;margin-bottom:.4rem;padding:.3rem;">${data.notes||''}</textarea>
        <div style="display:flex;gap:.5rem;">
          <button id="cf-save" style="${btnStyle('#1a4a2a')}">Enregistrer</button>
          <button id="cf-cancel" style="${btnStyle('#6b5d4f')}">Annuler</button>
        </div>
      </div>`;
    document.getElementById('cf-nonarme').addEventListener('change', e=>{
      document.getElementById('cf-arme').disabled = e.target.checked;
    });
    document.getElementById('cf-cancel').addEventListener('click', ()=>{ zone.innerHTML=''; });
    document.getElementById('cf-save').addEventListener('click', ()=>{
      const nom = document.getElementById('cf-nom').value.trim();
      if(!nom){ alert('Le nom est obligatoire.'); return; }
      const entry = {
        id: existant ? existant.id : nouvelIdManoeuvre(),
        nom,
        aptitude: document.getElementById('cf-apt').value || '',
        niveauRequis: parseInt(document.getElementById('cf-niveau').value)||0,
        segmentOctogone: document.getElementById('cf-segment').value || '',
        armeAssociee: document.getElementById('cf-arme').value.trim(),
        nonArme: document.getElementById('cf-nonarme').checked,
        effet: document.getElementById('cf-effet').value.trim(),
        notes: document.getElementById('cf-notes').value.trim(),
        ctp: data.ctp || null,
      };
      const liste = ensureManoeuvresState();
      const idx = liste.findIndex(m=>m.id===entry.id);
      if(idx!==-1) liste[idx]=entry; else liste.push(entry);
      if(typeof saveState==='function') saveState();
      installerPanneauEditeur();
      rafraichirGrilleCombatSiOuverte();
    });
  }

  function ouvrirBibliotheque(){
    (async()=>{
      await chargerCatalogue();
      const armesActionnables = (CATALOGUE.armes||[]).filter(a=>!a.generique && a.effet).map(a=>({...a,_source:'arme'}));
      const manoeuvresBib = (CATALOGUE.manoeuvres||[]).map(m=>({...m,_source:'manoeuvre'}));
      const tout = [...armesActionnables, ...manoeuvresBib];
      const zone = document.getElementById('combat-form-zone');
      if(!zone) return;
      zone.innerHTML = `<div style="border:2px solid #185FA5;border-radius:7px;padding:.6rem;margin-top:.5rem;background:#f0f6fc;max-height:260px;overflow-y:auto;">
        <input type="text" id="cf-search" placeholder="Rechercher…" style="width:100%;margin-bottom:.4rem;padding:.3rem;">
        <div id="cf-biblio-list"></div>
        <button id="cf-biblio-cancel" style="${btnStyle('#6b5d4f')};margin-top:.4rem;">Fermer</button>
      </div>`;
      const renderList=(filtre)=>{
        const f=(filtre||'').toLowerCase();
        const filtres = tout.filter(x=>x.nom.toLowerCase().includes(f));
        document.getElementById('cf-biblio-list').innerHTML = filtres.slice(0,40).map(x=>
          `<div class="cf-biblio-item" data-nom="${x.nom.replace(/"/g,'&quot;')}" style="padding:.3rem .4rem;cursor:pointer;border-bottom:1px dashed #ccc;font-size:.8rem;">
            ${x.nom} <span style="color:#888;font-size:.72rem;">(${x.niveau||'?'})</span>
          </div>`).join('') || '<div style="font-size:.78rem;color:#888;">Aucun résultat.</div>';
        document.querySelectorAll('.cf-biblio-item').forEach(el=>{
          el.addEventListener('click', ()=>{
            const item = tout.find(x=>x.nom===el.dataset.nom);
            if(!item) return;
            const pr = parsePrerequis(item.prerequis);
            const seg = parseOctogoneSegment(item.octogone);
            const secId = seg ? (SECTORS.find(s=>s.label.toLowerCase()===seg)||{}).id : '';
            ouvrirFormulaire(null, {
              nom:item.nom, aptitude: pr?pr.aptKey:'', niveauRequis: pr?pr.niveau:0,
              segmentOctogone: secId||'', armeAssociee: item._source==='arme'?item.nom:'',
              nonArme:false, effet:item.effet||'', notes:item.source||'', ctp:item.ctp||null
            });
          });
        });
      };
      renderList('');
      document.getElementById('cf-search').addEventListener('input', e=>renderList(e.target.value));
      document.getElementById('cf-biblio-cancel').addEventListener('click', ()=>{ zone.innerHTML=''; });
    })();
  }

  function rafraichirGrilleCombatSiOuverte(){
    if(document.getElementById('combat-manoeuvres-panel')) injecterPanneauManoeuvres();
  }

  // ── 1quater. Restauration après connexion (applyRemoteState ne connaît pas ce champ) ──
  function installerHookLogin(){
    if(typeof window.doLogin !== 'function'){ setTimeout(installerHookLogin,500); return; }
    if(window.doLogin.__sifhrWrapped) return;
    const original = window.doLogin;
    const wrapped = async function(tryGM){
      await original(tryGM);
      try{ await restaurerManoeuvresPersonnelles(); }
      catch(e){ console.error('[sifhr-combat-mode] restauration manœuvres a échoué :', e); }
    };
    wrapped.__sifhrWrapped = true;
    window.doLogin = wrapped;
  }

  async function restaurerManoeuvresPersonnelles(){
    if(typeof authenticated!=='undefined' && !authenticated) return;
    try{
      const r = await fetch(`${SUPABASE_URL}/rest/v1/fiches?id=eq.${encodeURIComponent(FICHE_ID)}&select=etat`,
        {headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY}});
      const d = await r.json();
      const saved = d[0]?.etat?.manoeuvresCombat;
      if(Array.isArray(saved)) state.manoeuvresCombat = saved;
    }catch(e){ console.error('[sifhr-combat-mode] fetch manœuvres', e); }
    // Ne pas écraser un formulaire en cours de remplissage (course possible si la
    // restauration réseau se termine pendant que le joueur saisit une manœuvre).
    const formZone = document.getElementById('combat-form-zone');
    if(formZone && formZone.innerHTML.trim()){
      console.log('[sifhr-combat-mode] restauration : formulaire ouvert, ré-affichage différé.');
      return;
    }
    installerPanneauEditeur();
  }

  // ── 2. Éligibilité d'une action par rapport au personnage local ──
  // Les entrées personnelles ont un schéma structuré (aptitude, niveauRequis,
  // segmentOctogone, armeAssociee, nonArme, ctp) — plus besoin de parser du texte.
  function evaluerManoeuvre(m){
    const raison = [];
    let bloque = false, limite = false;

    if(m.aptitude){
      const ai = APTITUDE_KEYS.indexOf(m.aptitude);
      const score = ai>=0 ? aptitudeScore(ai) : 0;
      const niveauRequis = m.niveauRequis||0;
      if(score < niveauRequis){
        bloque = true;
        raison.push(`${APT_LABELS[m.aptitude]||m.aptitude} N${niveauRequis} requis (actuel N${score})`);
      }
    }

    // Segment octogone associé : s'il est saturé et majoritairement dévoyé, la manœuvre est limitée (pas bloquée)
    let coupleIdx = null;
    if(m.segmentOctogone){
      const sec = SECTORS.find(s=>s.id===m.segmentOctogone);
      if(sec){
        coupleIdx = SEGMENT_TO_COUPLE[sec.label.toLowerCase()];
        if(coupleIdx===undefined) coupleIdx=null;
        const tokens = state.tokens[sec.id]||[];
        const w = tokens.filter(t=>t==='white').length;
        const b = tokens.filter(t=>t==='black').length;
        if(w+b===3 && b>w){
          limite = true;
          raison.push(`Segment ${sec.label} saturé et dévoyé — épreuve fragilisée`);
        }
      }
    }

    // Arme associée dans l'équipement (sauf manœuvre explicitement déclarée sans arme)
    let armeTrouvee = null;
    if(!m.nonArme && m.armeAssociee){
      const equip = (state.equipement||[]).filter(e=>e && e.title);
      armeTrouvee = equip.find(e=>e.title.toLowerCase().includes(m.armeAssociee.toLowerCase())
        || m.armeAssociee.toLowerCase().includes(e.title.toLowerCase()));
      if(!armeTrouvee){
        limite = true;
        raison.push(`« ${m.armeAssociee} » non trouvée dans l'Équipement — vérifier avant utilisation`);
      }
    }
    if(!raison.length && !bloque && !limite) raison.push('Disponible');

    return {bloque, limite, raison, aptKey: m.aptitude||null, coupleIdx, armeTrouvee, action:m};
  }

  // ── 3. UI : bouton flottant dédié + injection dans l'overlay des dés existant ──
  function installerBoutonCombat(){
    if(!document.body){
      // Le body n'est pas encore disponible : réessayer très vite plutôt que d'abandonner.
      setTimeout(installerBoutonCombat, 50);
      return;
    }
    if(document.getElementById('combat-fab')){
      console.log('[sifhr-combat-mode] bouton déjà présent, rien à faire.');
      return;
    }
    const btn = document.createElement('button');
    btn.id = 'combat-fab';
    btn.type = 'button';
    btn.textContent = '⚔';
    btn.title = 'Mode Combat';
    // z-index volontairement très élevé et position en !important-like (via cssText complet)
    // pour ne jamais être masqué par un autre élément fixe de la fiche.
    // Empilé au-dessus de #dice-fab (qui occupe déjà bottom:1.2rem/left:1.2rem,
    // 52px de haut), pour ne jamais le superposer.
    btn.style.cssText = 'position:fixed !important;bottom:82px !important;left:14px !important;'
      +'z-index:99999 !important;width:52px;height:52px;border-radius:50%;border:2px solid #fff;'
      +'background:#8b2020;color:#fff;font-size:1.3rem;cursor:pointer;'
      +'box-shadow:0 2px 10px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;';
    btn.addEventListener('click', ouvrirModeCombat);
    document.body.appendChild(btn);
    console.log('[sifhr-combat-mode] bouton ⚔ créé et ajouté au DOM ✓ (id=combat-fab)');
  }

  async function ouvrirModeCombat(){
    await chargerCatalogue();
    if(typeof openDice==='function') openDice();
    // Laisser le temps à l'écran de rôle / l'app de s'afficher, puis injecter notre panneau
    let tries=0;
    const tryInject=()=>{
      tries++;
      const app=document.getElementById('dice-app');
      if(app && app.style.display!=='none'){ injecterPanneauManoeuvres(); return; }
      if(tries<20) setTimeout(tryInject,300);
    };
    tryInject();
  }

  function injecterPanneauManoeuvres(){
    let panel = document.getElementById('combat-manoeuvres-panel');
    const hote = document.getElementById('apt-btn-grid');
    if(!hote) return;
    if(!panel){
      panel = document.createElement('div');
      panel.id = 'combat-manoeuvres-panel';
      panel.style.cssText = 'margin-bottom:.6rem;padding:.5rem .6rem;border:1px solid #8b2020;border-radius:6px;'
        +'background:rgba(139,32,32,.04);';
      hote.parentNode.insertBefore(panel, hote);
    }
    const actions = getActions();
    const titre = `<div style="font-family:Cinzel,serif;font-size:.7rem;color:#8b2020;letter-spacing:.05em;margin-bottom:.4rem;">⚔ MES MANŒUVRES DE COMBAT</div>`;
    if(!actions.length){
      panel.innerHTML = titre + `<div style="font-size:.78rem;font-style:italic;color:var(--ink3,#666);">`
        +`Aucune manœuvre dans votre collection. Ouvrez le panneau « Manœuvres de combat » de la fiche pour en créer.</div>`;
      return;
    }
    const boutons = actions.map(m=>{
      const ev = evaluerManoeuvre(m);
      const style = ev.bloque
        ? 'opacity:.35;cursor:not-allowed;background:#ddd;color:#888;'
        : ev.limite
          ? 'background:#fff3e0;border-color:#c8860a;color:#7a5200;'
          : 'background:#fdfaf3;border-color:#8b2020;color:#1a1510;';
      return `<button class="combat-man-btn" data-id="${m.id}" ${ev.bloque?'disabled':''}
        title="${ev.raison.join(' · ').replace(/"/g,'&quot;')}"
        style="font-family:'Crimson Text',serif;font-size:.78rem;padding:4px 9px;margin:2px;border-radius:5px;
        border:1px solid var(--border,#b8a88a);${style}cursor:${ev.bloque?'not-allowed':'pointer'};">
        ${m.nom}${ev.limite?' ⚠':''}
      </button>`;
    }).join('');
    panel.innerHTML = titre + boutons + `<div id="combat-man-choisie" style="margin-top:.4rem;font-size:.75rem;font-style:italic;color:#1a4a2a;"></div>`;
    panel.querySelectorAll('.combat-man-btn:not([disabled])').forEach(b=>{
      b.addEventListener('click', ()=>choisirManoeuvre(b.dataset.id));
    });
  }

  let _manoeuvreActive = null;
  function choisirManoeuvre(id){
    const m = getActions().find(x=>x.id===id);
    if(!m) return;
    const ev = evaluerManoeuvre(m);
    _manoeuvreActive = {m, ev};

    // 1. Aptitude — pilote le VRAI sélecteur existant
    if(ev.aptKey && typeof dSelectAptitude==='function'){
      const ai = APTITUDE_KEYS.indexOf(ev.aptKey);
      dSelectAptitude(ev.aptKey, aptitudeScore(ai));
    }

    // 2. Couple de valeurs — pré-rempli, modifiable ensuite normalement par le joueur
    if(ev.coupleIdx!=null){
      const s = dS();
      const [v1,v2] = COUPLES[ev.coupleIdx];
      s.successVal1=v1; s.successVal2=v2;
      if(typeof dRenderSuccessUnified==='function') dRenderSuccessUnified();
      if(typeof dComputeSuccesses==='function') dComputeSuccesses();
    }

    // Marquage visuel du bouton choisi
    document.querySelectorAll('.combat-man-btn').forEach(b=>b.style.outline='none');
    const btn=document.querySelector(`.combat-man-btn[data-id="${id}"]`);
    if(btn) btn.style.outline='2px solid #1a4a2a';
    const info=document.getElementById('combat-man-choisie');
    if(info) info.textContent = `Manœuvre retenue : ${m.nom}`
      + (ev.armeTrouvee?` — arme : ${ev.armeTrouvee.title}`:' — aucune arme identifiée automatiquement (vérifier).');
  }

  function bonusArmeActive(){
    if(!_manoeuvreActive) return 0;
    const ctp = _manoeuvreActive.m.ctp;
    if(!ctp) return 0;
    const {c,t,p}=ctp;
    return Math.round(((c||0)+(t||0)+(p||0))/2);
  }

  // ── 4. Table de résolution (identique à la version précédente) ──
  const EFFETS_COMBAT = {
    benin:{label:'Bénin (N1)', des:1, traitLevel:1, traitDuree:"Temporaire (assaut/scène)", jetons:1},
    moyen:{label:'Moyen (N2)', des:2, traitLevel:2, traitDuree:"Permanent (jusqu'au soin)", jetons:2},
    grave:{label:'Grave (N3)', des:3, traitLevel:3, traitDuree:"Permanent", jetons:3},
  };
  const ORDRE=[null,'benin','moyen','grave'];
  function palierDeMarge(m){ if(m<=0) return null; if(m===1) return 'benin'; if(m<=4) return 'moyen'; return 'grave'; }
  function monterPalier(p,c){ let i=ORDRE.indexOf(p); if(i<0)i=0; i=Math.min(i+c,ORDRE.length-1); return ORDRE[i]; }

  function installerHookDuel(){
    if(typeof window.dShowAdversaireResult !== 'function'){ setTimeout(installerHookDuel,500); return; }
    if(window.dShowAdversaireResult.__sifhrCombatWrapped) return;
    const original = window.dShowAdversaireResult;
    const wrapped = function(result, pid){
      original(result, pid);
      try{ dResoudreCombat(state.duelResult, result, pid); }
      catch(e){ console.error('[combat-mode] dResoudreCombat', e); }
    };
    wrapped.__sifhrCombatWrapped = true;
    window.dShowAdversaireResult = wrapped;
  }

  function dResoudreCombat(myResult, advResult, advId){
    if(!myResult || !advResult || !_manoeuvreActive) return; // pas de manœuvre = pas de résolution automatique
    const margeA = myResult.verdict==='echec_critique' ? -(myResult.oppositions||0) : (myResult.reussites||0);
    const margeB = advResult.verdict==='echec_critique' ? -(advResult.oppositions||0) : (advResult.reussites||0);
    const margeFinale = (margeA + bonusArmeActive()) - margeB;
    let palier = palierDeMarge(margeFinale);
    let cumulTout=false;
    const prouesse = !!document.querySelector('.dsuccess-opposition.prouesse');
    const prodige  = !!document.querySelector('.dsuccess-opposition.prodige');
    if(margeFinale>0 && prodige){ palier=monterPalier(palier,2); cumulTout=true; }
    else if(margeFinale>0 && prouesse){ palier=monterPalier(palier,1); }

    const advEchecCritique = advResult.verdict==='echec_critique';
    const palierAdv = advEchecCritique ? palierDeMarge(Math.abs(advResult.oppositions||0)) : null;

    if(palier) afficherPanneauResolution(palier, margeFinale, advId, cumulTout, palierAdv);
  }

  function afficherPanneauResolution(palier, marge, advId, cumulTout, palierAdv){
    const effets=EFFETS_COMBAT[palier];
    let panel=document.getElementById('combat-resolution-panel');
    if(!panel){
      panel=document.createElement('div');
      panel.id='combat-resolution-panel';
      panel.style.cssText='margin-top:.6rem;padding:.6rem .8rem;border:1px solid #8b2020;border-radius:7px;'
        +'background:rgba(139,32,32,.06);font-family:Crimson Text,serif;font-size:.85rem;';
      const box=document.getElementById('dfb-content')||document.getElementById('duel-feedback-box');
      (box||document.body).appendChild(panel);
    }
    const canaux=[
      {key:'des', label:`Dés dévoyés (${effets.des}) imposés au prochain lancer de ${advId}`},
      {key:'trait', label:`Trait de blessure niveau ${effets.traitLevel} (${effets.traitDuree})`},
      {key:'jetons', label:`${effets.jetons} jeton(s) dévoyé(s) dans l'octogone de ${advId}`},
    ];
    let html=`<div style="font-family:Cinzel,serif;font-size:.72rem;color:#8b2020;margin-bottom:.4rem;">`
      +`⚔ RÉSOLUTION — ${_manoeuvreActive.m.nom} — marge ${marge>=0?'+':''}${marge}, palier ${effets.label}</div>`;
    canaux.forEach(ca=>{
      const checked = cumulTout ? 'checked' : (ca.key==='des'?'checked':'');
      html+=`<label style="display:block;margin:.25rem 0;cursor:pointer;">`
        +`<input type="checkbox" class="combat-canal-cb" data-canal="${ca.key}" ${checked}> ${ca.label}</label>`;
    });
    if(palierAdv){
      html+=`<div style="margin-top:.4rem;font-style:italic;color:#8b2020;">Échec critique adverse : 1 jeton supplémentaire dévoyé automatiquement (palier ${palierAdv}).</div>`;
    }
    html+=`<button id="combat-envoyer-effets-btn" style="margin-top:.5rem;font-family:Cinzel,serif;font-size:.72rem;`
      +`padding:5px 12px;border:1px solid #8b2020;border-radius:5px;background:#8b2020;color:#fff;cursor:pointer;">`
      +`Envoyer les effets à ${advId}</button>`;
    panel.innerHTML=html;
    document.getElementById('combat-envoyer-effets-btn').addEventListener('click', ()=>{
      const choix=Array.from(panel.querySelectorAll('.combat-canal-cb')).filter(cb=>cb.checked).map(cb=>cb.dataset.canal);
      envoyerEffetsCombat(advId, palier, choix, palierAdv);
      panel.innerHTML += `<div style="margin-top:.4rem;color:#1a4a2a;">✓ Effets envoyés — en attente de confirmation par ${advId}.</div>`;
    });
  }

  async function envoyerEffetsCombat(targetId, palier, canaux, palierAdv){
    const effets=EFFETS_COMBAT[palier];
    try{
      const r=await fetch(`${SUPABASE_URL}/rest/v1/fiches?id=eq.${encodeURIComponent(targetId)}&select=etat`,
        {headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY}});
      const d=await r.json();
      const targetEtat=d[0]?.etat||{};
      targetEtat._combatEffectRequest={
        from:FICHE_ID, palier,
        effets:{des:effets.des, traitLevel:effets.traitLevel, traitDuree:effets.traitDuree, jetons:effets.jetons},
        canaux, palierAdv: palierAdv||null, ts:Date.now()
      };
      await fetch(`${SUPABASE_URL}/rest/v1/fiches`,{
        method:'POST',
        headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},
        body:JSON.stringify({id:targetId, etat:targetEtat})
      });
    }catch(e){ console.error('[combat-mode] envoi effets', e); }
  }

  // ── 5. Réception côté cible ──
  let _combatPending=null, _combatLastSeenTs=0;
  function afficherNotifCombat(req){
    _combatPending=req;
    const effets=req.effets;
    let box=document.getElementById('combat-notif-box');
    if(!box){
      box=document.createElement('div');
      box.id='combat-notif-box';
      box.style.cssText='position:fixed;bottom:14px;left:74px;right:14px;max-width:420px;z-index:9999;'
        +'background:#fff8f0;border:2px solid #8b2020;border-radius:8px;padding:.8rem 1rem;'
        +'font-family:Crimson Text,serif;font-size:.9rem;box-shadow:0 4px 18px rgba(0,0,0,.25);';
      document.body.appendChild(box);
    }
    const txt=req.canaux.map(c=>({
      des:`${effets.des} dé(s) dévoyé(s) au prochain lancer`,
      trait:`un Trait de blessure niveau ${effets.traitLevel} (${effets.traitDuree})`,
      jetons:`${effets.jetons} jeton(s) dévoyé(s) dans l'octogone`
    }[c])).join(', ');
    box.innerHTML=`<div style="font-family:Cinzel,serif;font-size:.75rem;color:#8b2020;margin-bottom:.4rem;">⚔ ${req.from} vous inflige les effets d'un combat (palier ${req.palier})</div>`
      +`<div style="margin-bottom:.6rem;">${txt||'(aucun canal sélectionné)'}</div>`
      +`<button id="combat-accept-btn" style="font-family:Cinzel,serif;font-size:.72rem;padding:4px 10px;margin-right:.5rem;border:1px solid #1a4a2a;border-radius:5px;background:#1a4a2a;color:#fff;cursor:pointer;">Accepter</button>`
      +`<button id="combat-refuse-btn" style="font-family:Cinzel,serif;font-size:.72rem;padding:4px 10px;border:1px solid #b8a88a;border-radius:5px;background:none;cursor:pointer;">Refuser</button>`;
    document.getElementById('combat-accept-btn').addEventListener('click', ()=>appliquerEffetsCombat(req,true));
    document.getElementById('combat-refuse-btn').addEventListener('click', ()=>appliquerEffetsCombat(req,false));
  }

  function appliquerEffetsCombat(req, accepte){
    const box=document.getElementById('combat-notif-box');
    if(accepte){
      const effets=req.effets;
      req.canaux.forEach(canal=>{
        if(canal==='des'){ const s=dS(); s.reds=(s.reds||0)+effets.des; }
        if(canal==='trait'){
          const emptyIdx=state.traits.findIndex(t=>!t.title&&!t.text);
          const entry={title:`Blessure (${req.from})`, text:`Infligée en combat — palier ${req.palier}.`, level:effets.traitLevel, levelType:'malus', locked:false};
          if(emptyIdx!==-1) state.traits[emptyIdx]=entry; else state.traits.push(entry);
          if(typeof renderTraits==='function') renderTraits();
        }
        if(canal==='jetons'){ for(let i=0;i<effets.jetons;i++) addToken('terre','black'); }
      });
      if(req.palierAdv){ addToken('feu','black'); }
      if(typeof saveState==='function') saveState();
    }
    if(box) box.remove();
    _combatPending=null;
  }

  async function pollerEffetsEntrants(){
    try{
      const r=await fetch(`${SUPABASE_URL}/rest/v1/fiches?id=eq.${encodeURIComponent(FICHE_ID)}&select=etat`,
        {headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY}});
      const d=await r.json();
      const req=d[0]?.etat?._combatEffectRequest;
      if(req && req.ts!==_combatLastSeenTs && !_combatPending){ _combatLastSeenTs=req.ts; afficherNotifCombat(req); }
    }catch(e){}
    setTimeout(pollerEffetsEntrants,5000);
  }

  // ── 6. Amorçage ──
  function init(){
    console.log('[sifhr-combat-mode] init() démarré, document.readyState=', document.readyState);
    try{ ensureManoeuvresState(); } catch(e){ console.error('[sifhr-combat-mode] ensureManoeuvresState a échoué :', e); }
    try{ installerBoutonCombat(); } catch(e){ console.error('[sifhr-combat-mode] installerBoutonCombat a échoué :', e); }
    try{ installerPanneauEditeur(); } catch(e){ console.error('[sifhr-combat-mode] installerPanneauEditeur a échoué :', e); }
    try{ installerHookLogin(); } catch(e){ console.error('[sifhr-combat-mode] installerHookLogin a échoué :', e); }
    try{ installerHookDuel(); } catch(e){ console.error('[sifhr-combat-mode] installerHookDuel a échoué :', e); }
    try{ pollerEffetsEntrants(); } catch(e){ console.error('[sifhr-combat-mode] pollerEffetsEntrants a échoué :', e); }
    try{ chargerCatalogue(); } catch(e){ console.error('[sifhr-combat-mode] chargerCatalogue a échoué :', e); }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
