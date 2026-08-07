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
   juste avant </body>, + sifhr_combat_data.json dans le
   même dossier.
   ============================================================ */
(function(){
  'use strict';
  console.log('[sifhr-combat-mode] script chargé et exécuté ✓');

  // ── 1. Catalogue (Phase 1 : export complet des 5 onglets de Combat.xlsx) ──
  // ── Banque de textes narratifs (variations, pour éviter la monotonie) ──
  // Format volontairement simple : une liste de gabarits par catégorie, {nom} comme
  // seule variable. Complétable par le meneur (voir NARRATIF.perso pour surcharger/
  // étendre depuis la console, en attendant un éditeur dédié) — les descriptions des
  // manœuvres et des effets peuvent aussi enrichir cette banque au fil du temps.
  const NARRATIF = {
    engagement: [
      "{nom} a l'initiative du combat, étant le plus déterminé.",
      "{nom} bondit le premier, résolu à ne laisser aucun répit à son adversaire.",
      "{nom} s'avance sans hésiter, décidé à imposer le rythme de l'assaut.",
    ],
    armeEnMain: [
      "{nom} brandit {arme}.",
      "{nom} porte la main à {arme} et la dégage d'un geste sûr.",
      "{nom} lève {arme}, prêt à en découdre.",
    ],
    armeChangement: [
      "{nom} délaisse son arme pour saisir {arme}.",
      "{nom} jette un regard à sa lame défaillante et se rue sur {arme}.",
    ],
    // Par polarité dominante d'axe saturé — voir choixNarratifOctogone()
    octogone: {
      'colere': [
        "{nom} se trouve dans un état d'excitation très important.",
        "{nom} laisse percer une colère qui menace de tout emporter.",
        "{nom} serre les mâchoires, à peine capable de contenir sa fureur.",
      ],
      'melancolie': [
        "{nom} semble alourdi, comme drainé de toute ardeur.",
        "{nom} peine à masquer un profond abattement.",
      ],
      'panique': [
        "{nom} laisse transparaître une inquiétude qu'il peine à dissimuler.",
        "{nom} jette des regards inquiets, cherchant une issue.",
      ],
      'confusion': [
        "{nom} semble ailleurs, comme égaré dans ses propres pensées.",
        "{nom} hésite un instant, comme frappé d'un doute soudain.",
      ],
      'calme': [
        "{nom} affiche une maîtrise de soi remarquable.",
        "{nom} respire avec calme, en pleine possession de ses moyens.",
      ],
    },
    manoeuvre: {
      'Défense': [
        "{nom} se met en garde et semble vouloir attendre son adversaire.",
        "{nom} recule d'un pas, jaugeant la distance avant de se figer, prêt à parer.",
      ],
      'Attaque': [
        "{nom} s'élance sans plus attendre.",
        "{nom} fond sur son adversaire avec une détermination farouche.",
      ],
      'Déplacement': [
        "{nom} se déplace avec vivacité, cherchant l'angle favorable.",
        "{nom} esquisse un pas de côté, prêt à surprendre.",
      ],
      'Soutien': [
        "{nom} appelle ses compagnons à se resserrer autour de lui.",
        "{nom} coordonne son geste avec ceux qui l'entourent.",
      ],
      'Discrétion': [
        "{nom} se fait plus discret, cherchant la faille.",
        "{nom} dissimule son intention derrière un geste anodin.",
      ],
      '': [
        "{nom} engage son geste avec assurance.",
      ],
    },
    trait: [
      "{nom} compte manifestement sur {trait} pour remporter le combat.",
      "{nom} puise dans {trait}, dont il maîtrise chaque nuance.",
    ],
    prouesse: [
      "{nom} semble déterminé et puise dans toutes ses réserves pour remporter le combat.",
      "{nom} rassemble ses forces pour un geste au-delà du commun.",
    ],
    prodige: [
      "{nom} laisse la pneuma affluer en lui, quitte à en payer le prix.",
      "{nom} s'en remet à des forces qui le dépassent.",
    ],
    pneuma: [
      "{nom} puise dans le souffle du lieu même où il se tient.",
      "{nom} sollicite la pneuma environnante pour affûter son geste.",
    ],
  };

  function piocher(liste){
    if(!liste || !liste.length) return '';
    return liste[Math.floor(Math.random()*liste.length)];
  }
  function texteNarratif(categorie, vars){
    vars = vars||{};
    let liste;
    if(categorie==='octogone') liste = NARRATIF.octogone[vars.polarite]||[];
    else if(categorie==='manoeuvre') liste = NARRATIF.manoeuvre[vars.categorie]||NARRATIF.manoeuvre[''];
    else liste = NARRATIF[categorie]||[];
    let txt = piocher(liste);
    Object.entries(vars).forEach(([k,v])=>{ txt = txt.replaceAll(`{${k}}`, v||''); });
    return txt;
  }
  // Traduit la polarité dominante d'un segment saturé en une des 5 familles narratives.
  const AXE_POLARITE_NARRATIVE = {
    'feu':'colere','bile_j':'colere', 'terre':'melancolie','bile_n':'melancolie',
    'eau':'panique','flegme':'panique', 'air':'confusion','sang':'confusion',
  };
  function choixNarratifOctogone(nom){
    try{
      let pireSegment=null, pireEcart=-1;
      SECTORS.forEach(sec=>{
        const tokens = state.tokens[sec.id]||[];
        const w = tokens.filter(t=>t==='white').length;
        const b = tokens.filter(t=>t==='black').length;
        if(w+b<3) return;
        const dominant = b>w ? AXE_POLARITE_NARRATIVE[sec.id] : 'calme';
        const ecart = Math.abs(w-b);
        if(ecart>pireEcart){ pireEcart=ecart; pireSegment=dominant; }
      });
      if(!pireSegment) return null;
      return texteNarratif('octogone', {nom, polarite:pireSegment});
    }catch(e){ return null; }
  }

  // Ajoute une ligne au journal narratif PARTAGÉ (visible par tous les participants,
  // pas seulement soi) — c'est tout l'intérêt : « ces informations peuvent être
  // communiquées à l'adversaire ».
  async function ajouterJournalNarratif(texte){
    if(!texte) return;
    await ecrireCombatSession(session=>{
      session.journalNarratif = session.journalNarratif || [];
      session.journalNarratif.push({texte, de:FICHE_ID, ts:Date.now(), assaut:session.assautNum||1});
    });
    injecterPanneauSession();
  }

  let CATALOGUE = null;
  async function chargerCatalogue(){
    if(CATALOGUE) return CATALOGUE;
    try{
      const r = await fetch(getBaseUrl()+'sifhr_combat_data.json');
      CATALOGUE = await r.json();
    }catch(e){
      console.error('[combat-mode] catalogue non chargé', e);
      CATALOGUE = {traits:[], equipement:[], manoeuvres:[], octogoneRestrictions:[], effets:[]};
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
            ${m.viceVertuIndicatif?' · <em>'+m.viceVertuIndicatif+'</em>':''}
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
    const data = existant || prefill || {nom:'',aptitude:'',niveauRequis:0,segmentOctogone:'',armeAssociee:'',nonArme:false,effet:'',notes:'',ctp:null,plafondAllies:null,viceVertuIndicatif:''};
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
        <div style="margin-bottom:.4rem;">
          <label style="font-size:.75rem;">Manœuvre collective — plafond d'alliés (vide = non collective) :
            <input type="number" id="cf-plafond-allies" min="0" max="12" value="${data.plafondAllies!=null?data.plafondAllies:''}" style="width:55px;">
          </label>
        </div>
        <div style="margin-bottom:.4rem;">
          <input type="text" id="cf-vicevertu" placeholder="Vice/Vertu indicatif (ex. Malignité N1) — non bloquant" value="${(data.viceVertuIndicatif||'').replace(/"/g,'&quot;')}" style="width:100%;padding:.3rem;">
        </div>
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
        viceVertuIndicatif: document.getElementById('cf-vicevertu').value.trim(),
        ctp: data.ctp || null,
        plafondAllies: document.getElementById('cf-plafond-allies').value!=='' ? parseInt(document.getElementById('cf-plafond-allies').value) : null,
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
      // Phase 1 : Equipement_v2 remplace l'ancien "armes actionnables" ; on ne propose
      // ici que les armes (pas les armures, qui ne sont pas des actions cliquables).
      const armesActionnables = (CATALOGUE.equipement||[])
        .filter(a=>a.effet && a.type && a.type.startsWith('Arme'))
        .map(a=>({...a,_source:'arme'}));
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
          `<div class="cf-biblio-item" data-id="${x.id}" style="padding:.3rem .4rem;cursor:pointer;border-bottom:1px dashed #ccc;font-size:.8rem;">
            ${x.nom} <span style="color:#888;font-size:.72rem;">(${x.niveau||'?'})</span>
          </div>`).join('') || '<div style="font-size:.78rem;color:#888;">Aucun résultat.</div>';
        document.querySelectorAll('.cf-biblio-item').forEach(el=>{
          el.addEventListener('click', ()=>{
            const item = tout.find(x=>x.id===el.dataset.id);
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
  // ── Phase 2 : arme en main et changement d'arme ─────────────────────
  let _armeEnMain = null;              // {id, nom} — persistée dans state.armeEnMain
  let _penaliteChangementArme = false; // levée au prochain lancer de dés

  function nomsCorrespondent(a, b){
    if(!a || !b) return false;
    a = a.toLowerCase(); b = b.toLowerCase();
    return a.includes(b) || b.includes(a);
  }

  function extraireBonusDe(effetTexte){
    if(!effetTexte) return 0;
    const m = String(effetTexte).match(/\+(\d)\s*D[ée]s?/i);
    return m ? parseInt(m[1]) : 0;
  }

  function restaurerArmeEnMain(){
    if(state.armeEnMain && state.armeEnMain.nom) _armeEnMain = state.armeEnMain;
  }

  function armesPossedees(){
    const equip = (state.equipement||[]).filter(e=>e && e.title);
    if(!CATALOGUE || !CATALOGUE.equipement) return equip.map(e=>({id:e.title, nom:e.title}));
    return equip
      .map(e=>{
        const c = CATALOGUE.equipement.find(x=>nomsCorrespondent(x.nom, e.title));
        return c && c.type && c.type.startsWith('Arme') ? c : null;
      })
      .filter(Boolean);
  }
  function armuresPossedees(){
    const equip = (state.equipement||[]).filter(e=>e && e.title);
    if(!CATALOGUE || !CATALOGUE.equipement) return [];
    return equip
      .map(e=>{
        const c = CATALOGUE.equipement.find(x=>nomsCorrespondent(x.nom, e.title));
        return c && c.type && c.type.startsWith('Armure') ? c : null;
      })
      .filter(Boolean);
  }
  // Armes du catalogue partagé que le personnage NE possède PAS — pour simuler
  // le ramassage d'une arme sur le champ de bataille (narratif : le meneur valide).
  function bibliothequeArmes(){
    if(!CATALOGUE || !CATALOGUE.equipement) return [];
    const possedeesIds = new Set(armesPossedees().map(a=>a.id));
    return CATALOGUE.equipement.filter(a=>a.type && a.type.startsWith('Arme') && !possedeesIds.has(a.id));
  }

  function equiperArme(item, viaChangement){
    _armeEnMain = { id:item.id, nom:item.nom };
    state.armeEnMain = _armeEnMain;
    if(typeof saveState==='function') saveState();
    if(viaChangement){
      _penaliteChangementArme = true;
    }
    injecterPanneauManoeuvres();
    injecterPanneauArme();
    ajouterJournalNarratif(texteNarratif(viaChangement?'armeChangement':'armeEnMain', {nom:FICHE_ID, arme:item.nom}));
  }

  function ramasserArme(item){
    const idx = state.equipement.findIndex(e=>!e || !e.title);
    const entry = {title:item.nom, text:'Ramassée sur le champ de bataille.', bm:0, image:null, locked:false};
    if(idx!==-1) state.equipement[idx] = entry; else state.equipement.push(entry);
    if(typeof saveState==='function') saveState();
    if(typeof renderEquipement==='function') renderEquipement();
    equiperArme(item, !!_armeEnMain);
  }

  let _ongletEquipement = 'inventaire'; // 'inventaire' | 'bibliotheque'
  let _detailsTechniquesOuverts = false;

  // Résumé technique replié par défaut (point 6) : saturations réelles et dés dévoyés,
  // pour qui veut vérifier le détail sans que ça encombre la lecture du récit.
  function resumeSaturationsTechnique(){
    try{
      const lignes = [];
      SECTORS.forEach(sec=>{
        const tokens = state.tokens[sec.id]||[];
        const w = tokens.filter(t=>t==='white').length;
        const b = tokens.filter(t=>t==='black').length;
        if(w+b>=2) lignes.push(`${sec.label} : ${w} pur / ${b} dévoyé`);
      });
      const reds = compterDesDevoyesPrecis();
      let txt = lignes.length ? lignes.join(' · ') : 'Aucun segment notablement chargé.';
      txt += ` — Dés dévoyés actuels : ${reds}`;
      return txt;
    }catch(e){ return ''; }
  }
  function injecterPanneauArme(){
    const hote = document.getElementById('apt-btn-grid');
    if(!hote) return;
    let panel = document.getElementById('combat-arme-panel');
    if(!panel){
      panel = document.createElement('div');
      panel.id = 'combat-arme-panel';
      panel.style.cssText = 'margin-bottom:.6rem;padding:.5rem .6rem;border:1px solid #7a5200;border-radius:6px;'
        +'background:rgba(122,82,0,.05);';
      hote.parentNode.insertBefore(panel, hote);
    }
    const armes = armesPossedees();
    const armures = armuresPossedees();
    const onglets = `<div style="display:flex;gap:.3rem;margin-bottom:.4rem;">
      <button class="combat-onglet-eq" data-onglet="inventaire" style="${btnStyle(_ongletEquipement==='inventaire'?'#7a5200':'#b8a88a', true)}">Mon équipement</button>
      <button class="combat-onglet-eq" data-onglet="bibliotheque" style="${btnStyle(_ongletEquipement==='bibliotheque'?'#7a5200':'#b8a88a', true)}">Bibliothèque du champ de bataille</button>
    </div>`;
    let html = `<div style="font-family:Cinzel,serif;font-size:.7rem;color:#7a5200;letter-spacing:.05em;margin-bottom:.4rem;">🗡 ÉQUIPEMENT</div>` + onglets;

    if(_ongletEquipement==='inventaire'){
      html += `<div style="font-size:.82rem;margin-bottom:.4rem;">Arme en main : ${_armeEnMain ? '<strong>'+_armeEnMain.nom+'</strong>' : '<em>Aucune</em>'}`
        + (_penaliteChangementArme?' <span style="color:#8b2020;">— changement en cours, manœuvres offensives bloquées ce round</span>':'')
        + `</div>`;
      if(!armes.length){
        html += `<div style="font-size:.78rem;font-style:italic;color:var(--ink3,#666);">Aucune arme identifiée dans l'Équipement.</div>`;
      } else {
        html += armes.map(a=>{
          const actif = _armeEnMain && _armeEnMain.id===a.id;
          return `<button class="combat-arme-btn" data-id="${a.id}" ${actif?'disabled':''}
            style="font-family:'Crimson Text',serif;font-size:.76rem;padding:3px 8px;margin:2px;border-radius:5px;
            border:1px solid #7a5200;background:${actif?'#7a5200':'#fff'};color:${actif?'#fff':'#7a5200'};
            cursor:${actif?'default':'pointer'};">${a.nom}</button>`;
        }).join('');
      }
      if(armures.length){
        html += `<div style="font-size:.7rem;color:var(--ink3,#666);margin-top:.5rem;">Armures portées : ${armures.map(a=>a.nom).join(', ')}</div>`;
      }
    } else {
      const dispo = bibliothequeArmes();
      html += `<div class="hint" style="font-size:.72rem;font-style:italic;color:var(--ink3,#666);margin-bottom:.4rem;">`
        + `Armes présentes dans le catalogue partagé mais absentes de votre Équipement — à n'utiliser que si le contexte narratif permet de s'en emparer (arme au sol, adversaire désarmé...).</div>`;
      if(!dispo.length){
        html += `<div style="font-size:.78rem;font-style:italic;">Rien de plus à proposer — vous possédez déjà toutes les armes du catalogue.</div>`;
      } else {
        html += dispo.map(a=>`<button class="combat-ramasser-btn" data-id="${a.id}"
          style="font-family:'Crimson Text',serif;font-size:.76rem;padding:3px 8px;margin:2px;border-radius:5px;
          border:1px solid #185FA5;background:#fff;color:#185FA5;cursor:pointer;">+ ${a.nom}</button>`).join('');
      }
    }
    panel.innerHTML = html;

    panel.querySelectorAll('.combat-onglet-eq').forEach(b=>b.addEventListener('click', ()=>{
      _ongletEquipement = b.dataset.onglet;
      injecterPanneauArme();
    }));
    panel.querySelectorAll('.combat-arme-btn:not([disabled])').forEach(b=>{
      b.addEventListener('click', ()=>{
        const item = armes.find(a=>a.id===b.dataset.id);
        if(!item) return;
        const dejaEquipee = !!_armeEnMain;
        if(dejaEquipee && !confirm(`Changer pour « ${item.nom} » ? Cela fait perdre l'avantage offensif de cet assaut (manœuvres offensives bloquées jusqu'au prochain lancer).`)) return;
        equiperArme(item, dejaEquipee);
      });
    });
    panel.querySelectorAll('.combat-ramasser-btn').forEach(b=>{
      b.addEventListener('click', ()=>{
        const item = bibliothequeArmes().find(a=>a.id===b.dataset.id);
        if(!item) return;
        if(!confirm(`Ramasser « ${item.nom} » ? À valider avec le meneur selon le contexte de la scène.`)) return;
        ramasserArme(item);
        _ongletEquipement = 'inventaire';
        injecterPanneauArme();
      });
    });
  }

  // ── Phase 4 : filtrage par état général de l'octogone (Octogone_Restrictions_v2) ──
  // Contrairement à la simple vérification du segment propre à la manœuvre (ci-dessous,
  // conservée), on regarde ici les 8 segments du personnage et on croise avec la table
  // de référence : une saturation dévoyée limite certaines catégories de manœuvres même
  // si leur propre segment associé n'a rien à voir avec l'axe saturé.
  function evaluerAxesOctogone(aptKey){
    const limitePar = [], favorisePar = [];
    if(!aptKey || !CATALOGUE || !CATALOGUE.octogoneRestrictions) return {limitePar, favorisePar};
    const label = APT_LABELS[aptKey] || aptKey;
    SECTORS.forEach(sec=>{
      const tokens = state.tokens[sec.id]||[];
      const w = tokens.filter(t=>t==='white').length;
      const b = tokens.filter(t=>t==='black').length;
      if(w+b<3) return; // pas saturé, rien à signaler
      const pur = w>b;
      const row = CATALOGUE.octogoneRestrictions.find(r=>
        r.element.toLowerCase().includes(sec.label.toLowerCase())
        && r.etatSaturation.toLowerCase().startsWith(pur?'majoritairement pur':'majoritairement dévoyé'));
      if(!row) return;
      const texte = pur ? row.favorisees : row.limitees;
      if(texte && texte!=='-' && texte.toLowerCase().includes(label.toLowerCase())){
        if(pur) favorisePar.push(`${row.element} saturé pur : ${row.effetSuggere}`);
        else limitePar.push(`${row.element} saturé dévoyé (${row.etatSaturation.match(/\((.+)\)/)?.[1]||''}) — ${row.limitees}`);
      }
    });
    return {limitePar, favorisePar};
  }

  // Fatigue générale : au-delà d'un certain nombre de dés dévoyés, les manœuvres
  // physiquement exigeantes (Se Mesurer, Se Déplacer de niveau élevé) sont fragilisées.
  const SEUIL_FATIGUE = 3;
  function evaluerFatigue(m){
    if(m.aptitude!=='se_mesurer' && m.aptitude!=='se_deplacer') return null;
    if((m.niveauRequis||0) < 2) return null;
    try{
      const reds = compterDesDevoyesPrecis() || dS().reds || 0;
      if(reds >= SEUIL_FATIGUE) return `${reds} dés dévoyés — fatigue générale, épreuve physique fragilisée`;
    }catch(e){}
    return null;
  }

  // ── Moteur de conditions structurées (Conditions Bonus/Malus, produit par l'éditeur de manœuvres) ──
  const FACTEUR_LABELS_COMBAT = {
    feu_force:'Force',feu_envie:'Envie',bile_j_charite:'Charité',bile_j_luxure:'Luxure',
    terre_loyaute:'Loyauté',terre_malignite:'Malignité',bile_n_prudence:'Prudence',bile_n_acedie:'Acédie',
    eau_temperance:'Tempérance',eau_lachete:'Lâcheté',flegme_chastete:'Chasteté',flegme_avarice:'Avarice',
    air_foi:'Foi',air_felonie:'Félonie',sang_esperance:'Espérance',sang_temerite:'Témérité',
    feu_b:'Feu ○',feu_n:'Feu ●',bile_j_b:'Bile Jaune ○',bile_j_n:'Bile Jaune ●',
    terre_b:'Terre ○',terre_n:'Terre ●',bile_n_b:'Bile Noire ○',bile_n_n:'Bile Noire ●',
    eau_b:'Eau ○',eau_n:'Eau ●',flegme_b:'Flegme ○',flegme_n:'Flegme ●',
    air_b:'Air ○',air_n:'Air ●',sang_b:'Sang ○',sang_n:'Sang ●',
    des_devoyes:'Dés dévoyés', arme_en_main:'Arme en main',
  };
  function labelFacteurCombat(f){
    if(f && f.startsWith('apt_')) return APT_LABELS[f.slice(4)] || f;
    return FACTEUR_LABELS_COMBAT[f] || f;
  }
  // Correction locale : le compteur natif de « dés dévoyés » (getPersonnageVal('des_devoyes'))
  // confond deux usages distincts de la propriété d.locked — un dé réellement dévoyé
  // (color==='black_token') et un dé simplement « fixé » après résolution manuelle
  // (dé de maîtrise/expertise, ou un résultat de 10 qui exige toujours une résolution
  // manuelle). Ces derniers ne sont pas des dés dévoyés et ne doivent pas compter comme tels.
  function compterDesDevoyesPrecis(){
    try{
      const s = dS();
      const dice = Array.isArray(s.dice) ? s.dice : ((s.dice && s.dice.dice) || []);
      const special = s.specialDice || {};
      return dice.filter((d,i)=>{
        if(d.color==='black_token') return true;
        if(!d.locked) return false;
        if(special[i]==='maitrise' || special[i]==='expertise') return false;
        if(d.value===10) return false;
        return true;
      }).length;
    }catch(e){ return 0; }
  }
  function lireValeurFacteur(facteur){
    if(!facteur) return 0;
    if(facteur.startsWith('apt_')){
      const ai = APTITUDE_KEYS.indexOf(facteur.slice(4));
      return ai>=0 ? aptitudeScore(ai) : 0;
    }
    if(facteur==='arme_en_main') return _armeEnMain ? 1 : 0;
    if(facteur==='des_devoyes') return compterDesDevoyesPrecis();
    if(typeof getPersonnageVal==='function'){
      try{ const v = getPersonnageVal(facteur); return (typeof v==='number') ? v : 0; }catch(e){ return 0; }
    }
    return 0;
  }
  function parseManConditions(str){
    if(!str) return [];
    return String(str).split(';').map(s=>s.trim()).filter(Boolean).map(part=>{
      const [facteur,code,seuil] = part.split('|');
      return {facteur:facteur||'', code:code||'', seuil:seuil!==undefined?seuil:''};
    });
  }
  // Résultat : {bloque, blocRaison, netLevel(-3..3), details[], prochaines[]}
  // `prochaines` liste les conditions Bonus non déclenchées, triées par écart croissant,
  // pour répondre à « qu'est-ce qu'il me manque pour le palier suivant ? ».
  function evaluerConditionsBonusMalus(m){
    const conds = parseManConditions(m.conditions);
    let bloque=false, blocRaison=null, netLevel=0;
    const details=[], prochaines=[];
    conds.forEach(c=>{
      let val, atteint;
      if(c.facteur==='trait'){
        val = (state.traits||[]).some(t=>t.title && t.title.toLowerCase().includes(String(c.seuil).toLowerCase())) ? 1 : 0;
        atteint = val>=1;
      } else {
        val = lireValeurFacteur(c.facteur);
        atteint = val >= parseFloat(c.seuil);
      }
      if(c.code==='R'){
        if(!atteint){
          bloque = true;
          blocRaison = c.facteur==='trait'
            ? `Nécessite le Trait « ${c.seuil} »`
            : `${labelFacteurCombat(c.facteur)} insuffisant (${val} / ${c.seuil} requis)`;
        }
      } else if(c.code){
        const niveau = parseInt(c.code.slice(1))||1;
        const signe = c.code[0]==='B' ? 1 : -1;
        if(atteint){
          netLevel += signe*niveau;
          details.push(`${signe>0?'+':''}${signe*niveau} — ${labelFacteurCombat(c.facteur)}`);
        } else if(signe>0 && c.facteur!=='trait'){
          prochaines.push({facteur:c.facteur, label:labelFacteurCombat(c.facteur), manque:(parseFloat(c.seuil)-val), seuil:c.seuil, val, niveau});
        }
      }
    });
    netLevel = Math.max(-3, Math.min(3, netLevel));
    prochaines.sort((a,b)=>a.manque-b.manque);
    return {bloque, blocRaison, netLevel, details, prochaines};
  }
  // Applique réellement le palier net au lanceur natif (dbmClick) — appelé juste après
  // dSelectAptitude (qui réinitialise les dés), pour ne jamais cumuler avec une sélection précédente.
  function appliquerBonusMalusNatif(netLevel){
    if(!netLevel || typeof dbmClick!=='function') return;
    if(netLevel>0) dbmClick('bonus', netLevel);
    else dbmClick('malus', -netLevel);
  }

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

    // Phase 4a : état général de l'octogone (les 8 segments, pas seulement celui de la manœuvre)
    if(m.aptitude){
      const {limitePar, favorisePar} = evaluerAxesOctogone(m.aptitude);
      if(limitePar.length){ limite = true; raison.push(...limitePar); }
      favorisePar.forEach(f=>raison.push(`✓ Favorisé — ${f}`));
    }

    // Phase 4b : fatigue (dés dévoyés en surnombre)
    const fatigue = evaluerFatigue(m);
    if(fatigue){ limite = true; raison.push(fatigue); }

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
      } else if(_armeEnMain && !nomsCorrespondent(m.armeAssociee, _armeEnMain.nom)){
        // Phase 2 : l'arme en main prime — une manœuvre liée à une AUTRE arme est bloquée,
        // pas juste limitée, sans quoi le choix d'arme n'a plus d'enjeu réel.
        bloque = true;
        raison.push(`Nécessite « ${m.armeAssociee} » en main (arme actuelle : ${_armeEnMain.nom})`);
      }
    }

    // Pénalité de changement d'arme : manœuvres offensives indisponibles pour cet assaut
    if(_penaliteChangementArme && m.aptitude!=='resister' && m.aptitude!=='se_deplacer'){
      bloque = true;
      raison.push(`Changement d'arme en cours — manœuvre offensive indisponible ce round`);
    }

    // Moteur de conditions structurées (produit par l'éditeur de manœuvres) : niveau
    // net de bonus/malus, et verrou dur supplémentaire si une condition Rédhibitoire échoue.
    const cbm = evaluerConditionsBonusMalus(m);
    if(cbm.bloque){ bloque = true; raison.push(cbm.blocRaison); }
    if(cbm.details.length) raison.push(...cbm.details);

    if(!raison.length && !bloque && !limite) raison.push('Disponible');

    return {bloque, limite, raison, aptKey: m.aptitude||null, coupleIdx, armeTrouvee, action:m,
      netLevel: cbm.netLevel, prochaines: cbm.prochaines};
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
    restaurerArmeEnMain();
    if(typeof openDice==='function') openDice();
    // Laisser le temps à l'écran de rôle / l'app de s'afficher, puis injecter nos panneaux
    let tries=0;
    const tryInject=()=>{
      tries++;
      const app=document.getElementById('dice-app');
      if(app && app.style.display!=='none'){
        // Ordre d'affichage voulu : Session en premier, puis Équipement, puis Manœuvres.
        injecterPanneauSession();
        injecterPanneauArme();
        injecterPanneauManoeuvres();
        masquerSectionsObsoletes();
        return;
      }
      if(tries<20) setTimeout(tryInject,300);
    };
    tryInject();
  }

  // Le duel et la collaboration natifs sont désormais couverts par la Session de
  // combat (ciblage par assaut) : ces deux blocs d'origine deviennent redondants
  // en Mode Combat, on les masque plutôt que de les dupliquer.
  function masquerSectionsObsoletes(){
    ['dice-duel-setup','dice-collab-setup','dice-group-btn','dice-group-waiting'].forEach(id=>{
      const el = document.getElementById(id);
      if(el) el.style.display = 'none';
    });
    // « ① Aptitude et trait utilisés » + la grille d'Aptitude native : entièrement
    // redondants en Mode Combat, l'Aptitude étant déterminée automatiquement par la
    // manœuvre choisie. On masque le libellé et la ligne, pas les Traits mobilisables
    // (toujours utiles) ni la grille elle-même (gardée en secours, juste discrète).
    try{
      const grid = document.getElementById('apt-btn-grid');
      if(grid){
        const setupCard = grid.closest('#dice-setup');
        if(setupCard){
          const label = setupCard.querySelector('.dice-step-label');
          const pickerRow = setupCard.querySelector('.apt-picker-row');
          if(label) label.style.display='none';
          if(pickerRow) pickerRow.style.display='none';
        }
        grid.style.display='none';
      }
    }catch(e){}
    // Bandeau visuel pour la Pneuma manquant nativement (contrairement à Prouesse/Prodige) —
    // injecté une seule fois.
    if(!document.getElementById('combat-pneuma-style')){
      const style = document.createElement('style');
      style.id = 'combat-pneuma-style';
      style.textContent = `#dpneuma-row{display:flex;align-items:center;gap:.5rem;margin:.3rem 0 .3rem;
        padding:.4rem .6rem;background:#f7f0e0;border-radius:6px;border:1px solid #c8860a;}`;
      document.head.appendChild(style);
    }
    ajouterInfosEtatsMobilisables();
  }

  // Ajoute une description en clair sur chaque « état mobilisable » (actuellement
  // seulement un nom + un badge de code, peu clair sans connaître la mécanique).
  const DESC_ETAT_EFFET = {
    relance: "Force une relance de toutes les valeurs de réussite obtenues à ce tour.",
    avantage: "Ajoute immédiatement un dé blanc supplémentaire au lancer.",
    opposition: "Des dés sont fixés en opposition — ils comptent contre la réussite.",
    expertise: "Un dé spécial dont la valeur peut être choisie après le lancer.",
    negation_prochain: "Annule les valeurs de réussite obtenues au prochain lancer.",
    des_bloques_axe12: "Les dés rouges sont bloqués sur les valeurs 1 ou 2, non modifiables.",
    des_non_modifiables: "Les dés de ce lancer ne peuvent plus être changés ou relancés.",
    hc: "Histoires croisées : un autre personnage est narrativement impliqué dans ce tirage.",
    pas_de_jetons_externes: "Aucun jeton ne peut être reçu d'un autre personnage ce tour.",
  };
  function ajouterInfosEtatsMobilisables(){
    try{
      const container = document.getElementById('detats-mobilisables');
      if(!container) return;
      container.querySelectorAll('div').forEach(row=>{
        if(row.querySelector('.combat-etat-info')) return;
        const label = row.querySelector('label');
        if(!label) return;
        const badge = row.querySelector('span');
        if(!badge) return;
        const key = Object.keys(ETAT_EFFET_LABEL||{}).find(k=>(ETAT_EFFET_LABEL[k]||'').includes(badge.textContent.replace(/^[▲▼⚠]\s*/,'').trim())
          || badge.textContent.includes(ETAT_EFFET_LABEL[k]));
        const desc = key ? DESC_ETAT_EFFET[key] : null;
        if(!desc) return;
        const info = document.createElement('span');
        info.className='combat-etat-info';
        info.textContent='?';
        info.title=desc;
        info.style.cssText='width:14px;height:14px;border-radius:50%;background:#7a5200;color:#fff;'
          +'font-size:.6rem;display:inline-flex;align-items:center;justify-content:center;cursor:help;margin-left:.2rem;';
        row.appendChild(info);
      });
    }catch(e){}
  }

  function reafficherSectionsObsoletes(){
    ['dice-duel-setup','dice-collab-setup'].forEach(id=>{
      const el = document.getElementById(id);
      if(el) el.style.display = '';
    });
  }

  // ── Phase 3 : session de combat multi-participants ──────────────────
  // Stockée sur la fiche d'ENVIRONNEMENT partagée (state.envFiche), pas sur
  // chaque fiche individuelle : une seule source de vérité pour tout le monde.
  function getEnvId(){
    if(typeof getEnvFicheId==='function'){ const v=getEnvFicheId(); if(v) return v; }
    return (state.envFiche && state.envFiche.trim()) ? state.envFiche.trim() : null;
  }

  async function fetchEnvEtat(envId){
    try{
      const r = await fetch(`${SUPABASE_URL}/rest/v1/fiches?id=eq.${encodeURIComponent(envId)}&select=etat`,
        {headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY}});
      const d = await r.json();
      return d[0]?.etat || {};
    }catch(e){ console.error('[sifhr-combat-mode] fetchEnvEtat', e); return {}; }
  }

  // Lecture-modification-écriture : on relit l'état courant de l'env, on applique
  // le mutateur sur combatSession, puis on réécrit — évite d'écraser ce que
  // d'autres participants viennent de changer entre-temps.
  async function ecrireCombatSession(mutator){
    const envId = getEnvId();
    if(!envId){ console.warn('[sifhr-combat-mode] pas de fiche environnement définie (state.envFiche).'); return null; }
    const etat = await fetchEnvEtat(envId);
    const session = etat.combatSession || { actif:false, assautNum:1, participants:{}, historique:[] };
    mutator(session);
    etat.combatSession = session;
    try{
      await fetch(`${SUPABASE_URL}/rest/v1/fiches`,{
        method:'POST',
        headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},
        body: JSON.stringify({id:envId, etat})
      });
    }catch(e){ console.error('[sifhr-combat-mode] ecrireCombatSession', e); }
    return session;
  }

  async function rejoindreCombat(){
    await ecrireCombatSession(session=>{
      session.actif = true;
      session.participants = session.participants || {};
      session.participants[FICHE_ID] = { participe:true, resolu:false, nom:FICHE_ID };
    });
    injecterPanneauSession();
  }
  // Ajoute un allié ou un adversaire supplémentaire à la session, à tout moment
  // (y compris en cours d'assaut) — joueur ou meneur, comme convenu.
  async function ajouterParticipantManuel(camp){
    const input = document.getElementById('combat-ajout-id');
    const id = input ? input.value.trim() : '';
    if(!id){ alert('Indique un identifiant de fiche.'); return; }
    await ecrireCombatSession(session=>{
      session.actif = true;
      session.participants = session.participants || {};
      session.participants[id] = { participe:true, resolu:false, nom:id, camp };
    });
    injecterPanneauSession();
  }
  async function quitterCombat(){
    await ecrireCombatSession(session=>{
      if(session.participants) delete session.participants[FICHE_ID];
    });
    injecterPanneauSession();
  }
  // Reproduit l'essentiel de dResetAll() (bannière de verrouillage, dés, bonus/malus,
  // dés spéciaux) SANS la confirmation bloquante — pour un déverrouillage automatique
  // au changement d'assaut plutôt qu'un « nouvelle partie » manuel.
  function deverrouillerLanceurPourNouvelAssaut(){
    try{
      if(typeof dUnlockLauncherFinal==='function') dUnlockLauncherFinal();
      const s = dS();
      s.rolled=false; s.dice=[];
      s.bonusMalus={bonus:{1:0,2:0,3:0},malus:{1:0,2:0,3:0}};
      s.specialDice={};
      s.oppositionDice=[];
      s.relanceDice=[];
      s.negationDice=[];
      s.firstRollSnapshot=null;
      s.successVal1=null; s.successVal2=null;
    }catch(e){ console.error('[sifhr-combat-mode] deverrouillerLanceurPourNouvelAssaut (état dés)', e); }
    try{ if(typeof ProdigeSystem!=='undefined') ProdigeSystem._fired=false; }catch(e){}
    try{ _pneumaExtractedDice = []; _pneumaSelectedCount = 0;
      const dpneumaList=document.getElementById('dpneuma-extracted-list');
      if(dpneumaList){ dpneumaList.style.display='none'; dpneumaList.innerHTML=''; }
    }catch(e){}
    try{ if(typeof dRenderDice==='function') dRenderDice(false); }catch(e){}
    try{ if(typeof dRenderSuccessUnified==='function') dRenderSuccessUnified(); }catch(e){}
  }

  async function assautSuivant(){
    await ecrireCombatSession(session=>{
      session.assautNum = (session.assautNum||1) + 1;
      Object.values(session.participants||{}).forEach(p=>p.resolu=false);
      session.historique = session.historique || [];
      session.historique.push({assaut: session.assautNum-1, ts: Date.now()});
    });
    deverrouillerLanceurPourNouvelAssaut();
    injecterPanneauSession();
  }
  async function terminerCombat(){
    if(!confirm('Terminer la session de combat pour tout le monde ? La liste des participants sera vidée.')) return;
    await ecrireCombatSession(session=>{
      session.actif=false;
      session.participants={}; // repart à zéro — sans ça, le même groupe revenait systématiquement
      session.assautNum=1;
    });
    injecterPanneauSession();
  }
  async function retirerParticipant(id){
    await ecrireCombatSession(session=>{
      if(session.participants) delete session.participants[id];
    });
    injecterPanneauSession();
  }
  async function marquerResolu(){
    const envId = getEnvId();
    if(!envId) return;
    const etat = await fetchEnvEtat(envId);
    const session = etat.combatSession;
    if(!session || !session.actif || !session.participants || !session.participants[FICHE_ID]) return;
    await ecrireCombatSession(s=>{
      if(s.participants && s.participants[FICHE_ID]) s.participants[FICHE_ID].resolu = true;
    });
    injecterPanneauSession();
  }

  function choisirCible(id){
    if(typeof dSetDuelTarget==='function') dSetDuelTarget(id);
    injecterPanneauSession();
  }

  async function injecterPanneauSession(){
    const hote = document.getElementById('apt-btn-grid');
    if(!hote) return;
    let panel = document.getElementById('combat-session-panel');
    if(!panel){
      panel = document.createElement('div');
      panel.id = 'combat-session-panel';
      panel.style.cssText = 'margin-bottom:.6rem;padding:.5rem .6rem;border:1px solid #185FA5;border-radius:6px;'
        +'background:rgba(24,95,165,.05);';
      hote.parentNode.insertBefore(panel, hote);
    }
    const envId = getEnvId();
    if(!envId){
      panel.innerHTML = `<div style="font-family:Cinzel,serif;font-size:.7rem;color:#185FA5;">⚔ SESSION DE COMBAT</div>
        <div style="font-size:.78rem;font-style:italic;color:var(--ink3,#666);">Aucune fiche d'environnement définie — la session multi-participants a besoin d'une fiche d'environnement partagée (voir en haut de la fiche).</div>`;
      return;
    }
    const etat = await fetchEnvEtat(envId);
    const session = etat.combatSession || { actif:false, participants:{} };
    const participants = session.participants || {};
    const moi = participants[FICHE_ID];

    let html = `<div style="font-family:Cinzel,serif;font-size:.7rem;color:#185FA5;letter-spacing:.05em;margin-bottom:.4rem;">⚔ SESSION DE COMBAT ${session.actif?('— Assaut '+(session.assautNum||1)):'(inactive)'}</div>`;

    if(!moi){
      html += `<button id="combat-rejoindre-btn" style="${btnStyle('#185FA5')}">Rejoindre le combat</button>`;
    } else {
      html += `<button id="combat-quitter-btn" style="${btnStyle('#6b5d4f')}">Quitter le combat</button> `;
      html += `<button id="combat-assaut-suivant-btn" style="${btnStyle('#185FA5')}">Assaut suivant →</button> `;
      html += `<button id="combat-terminer-btn" style="${btnStyle('#8b2020')}">Terminer</button>`;

      // Récit du combat — la partie qui doit sauter aux yeux ; les détails mécaniques
      // (saturations, dés) restent disponibles mais repliés par défaut (point 6).
      const journal = session.journalNarratif || [];
      if(journal.length){
        html += `<div style="margin-top:.6rem;padding:.5rem .6rem;background:#fdfaf3;border:1px solid #c8a86a;border-radius:6px;">
          <div style="font-family:Cinzel,serif;font-size:.65rem;color:#7a5200;margin-bottom:.3rem;">📜 RÉCIT</div>`;
        journal.slice(-8).forEach(j=>{
          html += `<div style="font-family:'Crimson Text',serif;font-style:italic;font-size:.82rem;margin-bottom:.25rem;">${j.texte}</div>`;
        });
        html += `</div>`;
      }
      html += `<div style="margin-top:.3rem;">
        <button id="combat-toggle-details-btn" style="${btnStyle('#6b5d4f',true)}">${_detailsTechniquesOuverts?'▼':'▶'} Détails techniques</button>
        <div id="combat-details-techniques" style="display:${_detailsTechniquesOuverts?'block':'none'};margin-top:.3rem;font-size:.75rem;color:var(--ink3,#666);">
          ${resumeSaturationsTechnique()}
        </div>
      </div>`;

      const roster = Object.entries(participants).filter(([id])=>id!==FICHE_ID);
      html += `<div style="margin-top:.5rem;font-size:.78rem;">`;
      html += `<div style="font-family:Cinzel,serif;font-size:.65rem;color:var(--ink3,#666);margin-bottom:.3rem;">PARTICIPANTS</div>`;
      html += `<div>${moi.resolu?'✅':'⏳'} ${FICHE_ID} (vous)${moi.camp?' <span style="opacity:.6;">['+moi.camp+']</span>':''}</div>`;
      roster.forEach(([id,p])=>{
        html += `<div>${p.resolu?'✅':'⏳'} ${id}${p.camp?' <span style="opacity:.6;">['+p.camp+']</span>':''} <button class="combat-cible-btn" data-id="${id}" style="${btnStyle('#8b2020',true)}">Cibler</button> <button class="combat-retirer-btn" data-id="${id}" style="${btnStyle('#6b5d4f',true)}">Retirer</button></div>`;
      });
      html += `</div>`;
      html += `<div style="margin-top:.5rem;display:flex;gap:.3rem;align-items:center;flex-wrap:wrap;">
        <input type="text" id="combat-ajout-id" placeholder="Identifiant de fiche (allié ou adversaire)" style="font-size:.78rem;padding:.25rem .4rem;flex:1;min-width:140px;">
        <button id="combat-ajout-allie-btn" style="${btnStyle('#1a4a2a', true)}">+ Allié</button>
        <button id="combat-ajout-adversaire-btn" style="${btnStyle('#8b2020', true)}">+ Adversaire</button>
      </div>`;

      // Historique assaut par assaut : qui l'emporte, marge, palier, effets appliqués —
      // ou égalité, pour comprendre ce qui s'est passé sans avoir dû suivre en direct.
      const historique = (session.historique || []).filter(h=>h && h.moi && h.adversaire && h.manoeuvre);
      if(historique.length){
        html += `<div style="margin-top:.6rem;border-top:1px dashed #185FA5;padding-top:.4rem;">
          <div style="font-family:Cinzel,serif;font-size:.65rem;color:var(--ink3,#666);margin-bottom:.3rem;">HISTORIQUE</div>`;
        historique.slice().reverse().forEach(h=>{
          let ligne;
          if(h.type==='victoire'){
            ligne = `<strong>${h.moi}</strong> l'emporte sur ${h.adversaire} (${h.manoeuvre}, marge ${h.marge>=0?'+':''}${h.marge}, ${h.palier})`
              + (h.effets && h.effets.length ? ` — ${h.effets.join(', ')}` : '');
          } else if(h.type==='egalite'){
            ligne = `Égalité entre ${h.moi} et ${h.adversaire} (${h.manoeuvre}, marge ${h.marge})`;
          } else {
            ligne = `${h.moi} contre ${h.adversaire} (${h.manoeuvre}) — marge insuffisante pour un effet`;
          }
          html += `<div style="font-size:.72rem;margin-bottom:.25rem;">Assaut ${h.assaut} — ${ligne}</div>`;
        });
        html += `</div>`;
      }
    }
    panel.innerHTML = html;

    const rb = document.getElementById('combat-rejoindre-btn'); if(rb) rb.addEventListener('click', rejoindreCombat);
    const qb = document.getElementById('combat-quitter-btn'); if(qb) qb.addEventListener('click', quitterCombat);
    const ajA = document.getElementById('combat-ajout-allie-btn');
    if(ajA) ajA.addEventListener('click', ()=>ajouterParticipantManuel('allie'));
    const ajE = document.getElementById('combat-ajout-adversaire-btn');
    if(ajE) ajE.addEventListener('click', ()=>ajouterParticipantManuel('adversaire'));
    const ab = document.getElementById('combat-assaut-suivant-btn'); if(ab) ab.addEventListener('click', assautSuivant);
    const tb = document.getElementById('combat-terminer-btn'); if(tb) tb.addEventListener('click', terminerCombat);
    panel.querySelectorAll('.combat-cible-btn').forEach(b=>b.addEventListener('click', ()=>choisirCible(b.dataset.id)));
    panel.querySelectorAll('.combat-retirer-btn').forEach(b=>b.addEventListener('click', ()=>{
      if(confirm(`Retirer ${b.dataset.id} de la session de combat ?`)) retirerParticipant(b.dataset.id);
    }));
    const dtb = document.getElementById('combat-toggle-details-btn');
    if(dtb) dtb.addEventListener('click', ()=>{
      _detailsTechniquesOuverts = !_detailsTechniquesOuverts;
      injecterPanneauSession();
    });
  }

  // Rafraîchissement périodique du panneau (pour voir en direct qui a résolu son assaut)
  function demarrerRafraichissementSession(){
    setInterval(()=>{
      if(document.getElementById('combat-session-panel')) injecterPanneauSession();
    }, 4000);
  }

  // Marquer "résolu" dès que ce joueur lance ses dés, si une session est active
  function installerHookTraitEngage(){
    if(typeof window._activateTrait !== 'function'){ setTimeout(installerHookTraitEngage,500); return; }
    if(window._activateTrait.__sifhrCombatWrapped) return;
    const original = window._activateTrait;
    const wrapped = function(trait){
      const r = original.apply(this, arguments);
      try{
        if(_manoeuvreActive) ajouterJournalNarratif(texteNarratif('trait', {nom:FICHE_ID, trait:trait?.title||'un Trait engagé'}));
      }catch(e){}
      return r;
    };
    wrapped.__sifhrCombatWrapped = true;
    window._activateTrait = wrapped;
  }

  function installerHookProuesseProdigePneuma(){
    const pr = document.getElementById('dprouesse-toggle');
    const pd = document.getElementById('dprodige-toggle');
    const pn = document.getElementById('dpneuma-toggle');
    if(!pr || !pd || !pn){ setTimeout(installerHookProuesseProdigePneuma,500); return; }
    if(pr.dataset.sifhrHooked) return;
    [[pr,'prouesse'],[pd,'prodige'],[pn,'pneuma']].forEach(([el,cat])=>{
      el.dataset.sifhrHooked='1';
      el.addEventListener('change', ()=>{
        if(el.checked && _manoeuvreActive) ajouterJournalNarratif(texteNarratif(cat, {nom:FICHE_ID}));
      });
    });
  }

  function installerHookEtatsMobilisables(){
    if(typeof window.renderEtatsMobilisables !== 'function'){ setTimeout(installerHookEtatsMobilisables,500); return; }
    if(window.renderEtatsMobilisables.__sifhrCombatWrapped) return;
    const original = window.renderEtatsMobilisables;
    const wrapped = function(...args){
      const r = original.apply(this,args);
      try{ ajouterInfosEtatsMobilisables(); }catch(e){}
      return r;
    };
    wrapped.__sifhrCombatWrapped = true;
    window.renderEtatsMobilisables = wrapped;
  }

  function installerHookRollResolu(){
    if(typeof window.dRollDice !== 'function'){ setTimeout(installerHookRollResolu,500); return; }
    if(window.dRollDice.__sifhrCombatWrapped) return;
    const original = window.dRollDice;
    const wrapped = function(...args){
      const r = original.apply(this,args);
      try{ marquerResolu(); }catch(e){}
      if(_penaliteChangementArme){
        _penaliteChangementArme = false;
        try{ injecterPanneauArme(); injecterPanneauManoeuvres(); }catch(e){}
      }
      return r;
    };
    wrapped.__sifhrCombatWrapped = true;
    window.dRollDice = wrapped;
  }

  // Palette : impossible (gris) → malus 3/2/1 (rouges dégradés) → neutre (crème) → bonus 1/2/3 (verts dégradés)
  const PALETTE_NIVEAU = {
    '-3':{bg:'#7a1f1f',fg:'#fff',label:'Malus III — Négation'},
    '-2':{bg:'#a8412f',fg:'#fff',label:'Malus II — Opposition'},
    '-1':{bg:'#d97f5c',fg:'#fff',label:'Malus I — Relance'},
    '0':{bg:'#fdfaf3',fg:'#1a1510',label:'Neutre'},
    '1':{bg:'#a8c890',fg:'#1a1510',label:'Bonus I — Avantage'},
    '2':{bg:'#6fa050',fg:'#fff',label:'Bonus II — Expertise'},
    '3':{bg:'#3d6b28',fg:'#fff',label:'Bonus III — Maîtrise'},
  };

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
    const grille = actions.map(m=>{
      const ev = evaluerManoeuvre(m);
      const pal = PALETTE_NIVEAU[String(ev.bloque?0:ev.netLevel)] || PALETTE_NIVEAU['0'];
      const styleBloque = ev.bloque ? 'opacity:.4;background:#ccc !important;color:#666 !important;' : '';
      return `<button class="combat-man-btn" data-id="${m.id}" data-bloque="${ev.bloque?'1':'0'}"
        style="font-family:'Crimson Text',serif;font-size:.78rem;padding:5px 10px;margin:2px;border-radius:5px;
        border:1px solid rgba(0,0,0,.25);background:${pal.bg};color:${pal.fg};${styleBloque}
        cursor:${ev.bloque?'not-allowed':'pointer'};position:relative;">
        ${m.nom}
      </button>`;
    }).join('');
    panel.innerHTML = titre + `<div style="display:flex;flex-wrap:wrap;">${grille}</div>`
      + `<div id="combat-man-detail" style="margin-top:.5rem;"></div>`
      + `<div id="combat-man-choisie" style="margin-top:.4rem;font-size:.75rem;font-style:italic;color:#1a4a2a;"></div>`;
    panel.querySelectorAll('.combat-man-btn').forEach(b=>{
      b.addEventListener('click', ()=>{
        if(b.dataset.bloque==='1'){ afficherDetailManoeuvre(b.dataset.id); return; }
        choisirManoeuvre(b.dataset.id);
        afficherDetailManoeuvre(b.dataset.id);
      });
    });
  }

  // Détail au clic : palier actuel, raisons, et ce qu'il manque pour le palier supérieur.
  function afficherDetailManoeuvre(id){
    const m = getActions().find(a=>a.id===id);
    if(!m) return;
    const ev = evaluerManoeuvre(m);
    const host = document.getElementById('combat-man-detail');
    if(!host) return;
    const pal = PALETTE_NIVEAU[String(ev.bloque?0:ev.netLevel)] || PALETTE_NIVEAU['0'];
    let html = `<div style="border:1px solid rgba(0,0,0,.15);border-radius:6px;padding:.5rem .7rem;background:#fff;">
      <div style="font-family:Cinzel,serif;font-size:.72rem;color:${pal.bg};margin-bottom:.3rem;">
        ${m.nom} — ${ev.bloque?'Impossible':pal.label}</div>`;
    if(ev.bloque){
      html += `<div style="font-size:.78rem;">${ev.raison.filter(r=>r!=='Disponible').join(' · ')}</div>`;
    } else {
      if(ev.details && ev.details.length) html += `<div style="font-size:.78rem;">Facteurs actifs : ${ev.details.join(', ')}</div>`;
      if(ev.prochaines && ev.prochaines.length){
        const p = ev.prochaines[0];
        html += `<div style="font-size:.78rem;margin-top:.3rem;color:#7a5200;">Pour un bonus supplémentaire (niveau ${p.niveau}) : `
          + `${p.label} doit atteindre ${p.seuil} (actuellement ${p.val}, il manque ${p.manque}).</div>`;
      } else if(ev.netLevel<3){
        html += `<div style="font-size:.78rem;margin-top:.3rem;color:var(--ink3,#666);">Aucune condition de bonus supplémentaire connue pour cette manœuvre.</div>`;
      }
    }
    html += `</div>`;
    host.innerHTML = html;
  }

  let _manoeuvreActive = null;
  async function choisirManoeuvre(id){
    const m = getActions().find(x=>x.id===id);
    if(!m) return;
    const ev = evaluerManoeuvre(m);
    _manoeuvreActive = {m, ev};

    // 1. Aptitude — pilote le VRAI sélecteur existant (réinitialise aussi les dés,
    //    donc c'est le bon moment pour appliquer le palier net sans risque de cumul)
    if(ev.aptKey && typeof dSelectAptitude==='function'){
      const ai = APTITUDE_KEYS.indexOf(ev.aptKey);
      dSelectAptitude(ev.aptKey, aptitudeScore(ai));
    }
    appliquerBonusMalusNatif(ev.netLevel);

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
    let infoTxt = `Manœuvre retenue : ${m.nom} — ${(PALETTE_NIVEAU[String(ev.netLevel)]||PALETTE_NIVEAU['0']).label}`
      + (ev.armeTrouvee?` — arme : ${ev.armeTrouvee.title}`:' — aucune arme identifiée automatiquement (vérifier).');

    // Manœuvre collective : demander combien d'alliés participent (plafonné par manœuvre)
    _manoeuvreActive.alliesDeclares = 0;
    if(m.plafondAllies!=null && m.plafondAllies>0){
      const n = prompt(`Manœuvre collective — combien d'alliés participent (max ${m.plafondAllies}) ?`, '0');
      const val = Math.max(0, Math.min(m.plafondAllies, parseInt(n)||0));
      _manoeuvreActive.alliesDeclares = val;
      infoTxt += ` — ${val} allié(s) déclaré(s)`;
    }
    if(info) info.textContent = infoTxt;

    // Textes narratifs partagés : état de l'octogone, puis type de manœuvre engagée.
    // Textes narratifs partagés : état de l'octogone, puis type de manœuvre engagée.
    // Séquentiel et attendu, comme pour l'historique — deux écritures concurrentes sur
    // la même session partagée s'écrasent l'une l'autre sinon (constaté en test).
    const texteOctogone = choixNarratifOctogone(FICHE_ID);
    if(texteOctogone) await ajouterJournalNarratif(texteOctogone);
    await ajouterJournalNarratif(texteNarratif('manoeuvre', {nom:FICHE_ID, categorie:m.categorie}));
  }

  function bonusArmeActive(){
    if(!_manoeuvreActive) return 0;
    const ctp = _manoeuvreActive.m.ctp;
    let bonus = 0;
    if(ctp){
      const {c,t,p}=ctp;
      bonus += Math.round(((c||0)+(t||0)+(p||0))/2);
    } else if(_armeEnMain && CATALOGUE && CATALOGUE.equipement){
      // Phase 2 : à défaut de profil C/T/P sur la manœuvre elle-même, on tire un
      // bonus simple du texte de l'arme en main (ex. "+1 Dé", "+2 Dés").
      const item = CATALOGUE.equipement.find(x=>x.id===_armeEnMain.id);
      if(item) bonus += extraireBonusDe(item.effet);
    }
    // Bonus collectif simplifié : +1 par allié déclaré (voir Phase 3 — à affiner
    // quand Manoeuvres_Combat_v2 précisera le montant exact du bonus par manœuvre).
    bonus += _manoeuvreActive.alliesDeclares || 0;
    return bonus;
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
    if(!myResult || !advResult || !_manoeuvreActive || !_manoeuvreActive.m || !advId) return; // appel incomplet = pas de résolution
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

    if(palier){
      afficherPanneauResolution(palier, margeFinale, advId, cumulTout, palierAdv);
    } else if(FICHE_ID && advId && _manoeuvreActive.m.nom){
      enregistrerHistorique({
        type: margeFinale===0 ? 'egalite' : 'sans-effet',
        moi: FICHE_ID, adversaire: advId, marge: margeFinale,
        manoeuvre: _manoeuvreActive.m.nom,
      });
    }
  }

  // Ajoute une entrée à l'historique partagé de la session (visible de tous les
  // participants) — appelé aussi bien pour une égalité que pour une victoire nette.
  async function enregistrerHistorique(entree){
    await ecrireCombatSession(session=>{
      session.historique = session.historique || [];
      entree.assaut = session.assautNum || 1;
      entree.ts = Date.now();
      session.historique.push(entree);
    });
    injecterPanneauSession();
  }

  const PALIER_TO_NIVEAU = {benin:'N1', moyen:'N2', grave:'N3'};

  async function afficherPanneauResolution(palier, marge, advId, cumulTout, palierAdv){
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
    panel.innerHTML = '<div style="font-style:italic;color:var(--ink3,#666);">Résolution en cours…</div>';

    // Vue sur les dés dévoyés actuels de l'adversaire (dernier état connu, pas nécessairement
    // en direct s'il n'a pas encore sauvegardé son lancer en cours).
    let advRedsActuels = '?';
    try{
      const advEtat = await fetchEnvEtat(advId);
      if(advEtat && advEtat.dice){
        advRedsActuels = (advEtat.dice.dice||[]).filter(d=>d.color==='black_token'||d.locked).length;
      }
    }catch(e){}

    const canaux=[
      {key:'des', label:`Dés dévoyés : ${advId} en a actuellement ${advRedsActuels} (dernier état connu) — en imposer ${effets.des} de plus au prochain lancer`},
      {key:'trait', label:`Trait de blessure niveau ${effets.traitLevel} (${effets.traitDuree})`},
    ];
    const niveau = PALIER_TO_NIVEAU[palier];
    const effetsNommesPerdant = (CATALOGUE && CATALOGUE.effets ? CATALOGUE.effets : [])
      .filter(e=>e.niveau===niveau && e.cible==='perdant');
    const effetsNommesGagnant = (CATALOGUE && CATALOGUE.effets ? CATALOGUE.effets : [])
      .filter(e=>e.niveau===niveau && e.cible==='gagnant');
    // Effets liés spécifiquement à la manœuvre utilisée (si l'éditeur en a associé)
    const effetsLiesManoeuvre = (_manoeuvreActive && _manoeuvreActive.m.effetsAssocies)
      ? String(_manoeuvreActive.m.effetsAssocies).split(',').map(s=>s.trim()).filter(Boolean)
        .map(id=>(CATALOGUE.effets||[]).find(e=>e.id===id)).filter(Boolean)
      : [];

    let html=`<div style="font-family:Cinzel,serif;font-size:.72rem;color:#8b2020;margin-bottom:.4rem;">`
      +`⚔ RÉSOLUTION — ${_manoeuvreActive.m.nom} — marge ${marge>=0?'+':''}${marge}, palier ${effets.label}</div>`;
    canaux.forEach(ca=>{
      const checked = cumulTout ? 'checked' : (ca.key==='des'?'checked':'');
      html+=`<label style="display:block;margin:.25rem 0;cursor:pointer;">`
        +`<input type="checkbox" class="combat-canal-cb" data-canal="${ca.key}" ${checked}> ${ca.label}</label>`;
    });

    // Ciblage de l'octogone : soi ou l'adversaire, segment, polarité, quantité.
    const segOptions = SECTORS.map(s=>`<option value="${s.id}">${s.label}</option>`).join('');
    html += `<div style="margin-top:.4rem;padding:.4rem;border:1px dashed #8b2020;border-radius:5px;">
      <div style="font-size:.72rem;font-family:Cinzel,serif;color:#8b2020;margin-bottom:.3rem;">JETONS D'OCTOGONE</div>
      <div style="display:flex;gap:.3rem;flex-wrap:wrap;align-items:center;">
        <select id="oct-cible"><option value="adversaire">Octogone de ${advId}</option><option value="soi">Mon propre octogone</option></select>
        <select id="oct-segment">${segOptions}</select>
        <select id="oct-polarite"><option value="devoye" selected>Dévoyé (noir)</option><option value="pur">Pur (blanc)</option></select>
        <input type="number" id="oct-quantite" value="${effets.jetons}" min="1" max="3" style="width:50px;">
        <button id="oct-appliquer-btn" style="${btnStyle('#8b2020', true)}">Appliquer</button>
      </div>
      <div id="oct-statut" style="font-size:.72rem;margin-top:.3rem;"></div>
    </div>`;

    if(effetsNommesPerdant.length){
      html += `<div style="font-family:Cinzel,serif;font-size:.65rem;color:#7a5200;margin-top:.4rem;">EFFETS NOMMÉS DISPONIBLES POUR ${advId} (facultatif, en plus)</div>`;
      effetsNommesPerdant.forEach(e=>{
        html += `<label style="display:block;margin:.2rem 0;cursor:pointer;font-size:.8rem;">`
          + `<input type="checkbox" class="combat-effet-nomme-cb" data-id="${e.id}"> ${e.nom.trim()} — ${e.effet}</label>`;
      });
    }
    if(effetsLiesManoeuvre.length){
      html += `<div style="font-family:Cinzel,serif;font-size:.65rem;color:#185FA5;margin-top:.4rem;">EFFETS LIÉS À « ${_manoeuvreActive.m.nom} »</div>`;
      effetsLiesManoeuvre.forEach(e=>{
        html += `<label style="display:block;margin:.2rem 0;cursor:pointer;font-size:.8rem;">`
          + `<input type="checkbox" class="combat-effet-nomme-cb" data-id="${e.id}"> ${e.nom.trim()} (${e.niveau}, ${e.cible}) — ${e.effet}</label>`;
      });
    }
    if(palierAdv){
      html+=`<div style="margin-top:.4rem;font-style:italic;color:#8b2020;">Échec critique adverse : 1 jeton supplémentaire dévoyé automatiquement (palier ${palierAdv}).</div>`;
    }
    html+=`<button id="combat-envoyer-effets-btn" style="margin-top:.5rem;font-family:Cinzel,serif;font-size:.72rem;`
      +`padding:5px 12px;border:1px solid #8b2020;border-radius:5px;background:#8b2020;color:#fff;cursor:pointer;">`
      +`Envoyer les effets à ${advId}</button>`;
    if(effetsNommesGagnant.length){
      html += `<div style="font-family:Cinzel,serif;font-size:.65rem;color:#1a4a2a;margin-top:.6rem;">POUR VOUS-MÊME (${effets.label})</div>`;
      effetsNommesGagnant.forEach(e=>{
        html += `<button class="combat-effet-soi-btn" data-id="${e.id}" style="${btnStyle('#1a4a2a',true)};display:block;margin:.2rem 0;text-align:left;">`
          + `+ ${e.nom.trim()} — ${e.effet}</button>`;
      });
    }
    panel.innerHTML=html;

    document.getElementById('oct-appliquer-btn').addEventListener('click', async ()=>{
      const cible = document.getElementById('oct-cible').value;
      const segment = document.getElementById('oct-segment').value;
      const polarite = document.getElementById('oct-polarite').value;
      const quantite = parseInt(document.getElementById('oct-quantite').value)||1;
      const statut = document.getElementById('oct-statut');
      if(cible==='soi'){
        for(let i=0;i<quantite;i++) addToken(segment, polarite==='pur'?'white':'black');
        if(typeof saveState==='function') saveState();
        statut.innerHTML = `<span style="color:#1a4a2a;">✓ Appliqué à votre propre octogone.</span>`;
      } else {
        _octogoneCustomAEnvoyer = {segment, polarite, quantite};
        statut.innerHTML = `<span style="color:#1a4a2a;">✓ Prêt à envoyer avec les autres effets (bouton « Envoyer les effets »).</span>`;
      }
    });

    document.getElementById('combat-envoyer-effets-btn').addEventListener('click', async ()=>{
      const btnEnvoi = document.getElementById('combat-envoyer-effets-btn');
      btnEnvoi.disabled = true; btnEnvoi.textContent = 'Envoi en cours…';
      const choix=Array.from(panel.querySelectorAll('.combat-canal-cb')).filter(cb=>cb.checked).map(cb=>cb.dataset.canal);
      const effetsNommesChoisis = Array.from(panel.querySelectorAll('.combat-effet-nomme-cb')).filter(cb=>cb.checked)
        .map(cb=>[...effetsNommesPerdant,...effetsLiesManoeuvre].find(e=>e.id===cb.dataset.id)).filter(Boolean);
      // Séquentiel et attendu : deux écritures asynchrones sur la même session partagée
      // qui se chevauchent peuvent s'écraser l'une l'autre (condition de course constatée
      // en test) si on ne les attend pas l'une après l'autre.
      await envoyerEffetsCombat(advId, palier, choix, palierAdv, effetsNommesChoisis, _octogoneCustomAEnvoyer);
      await enregistrerHistorique({
        type: 'victoire',
        moi: FICHE_ID, adversaire: advId, marge, palier: effets.label,
        manoeuvre: _manoeuvreActive.m.nom,
        effets: [...choix.map(c=>c==='des'?`+${effets.des} dés dévoyés`:`Trait niveau ${effets.traitLevel}`),
          ..._octogoneCustomAEnvoyer?[`${_octogoneCustomAEnvoyer.quantite} jeton(s) ${_octogoneCustomAEnvoyer.polarite}`]:[],
          ...effetsNommesChoisis.map(e=>e.nom.trim())],
      });
      _octogoneCustomAEnvoyer = null;
      panel.innerHTML += `<div style="margin-top:.4rem;color:#1a4a2a;">✓ Effets envoyés — en attente de confirmation par ${advId}.</div>`;
    });
    panel.querySelectorAll('.combat-effet-soi-btn').forEach(b=>{
      b.addEventListener('click', ()=>{
        const e = effetsNommesGagnant.find(x=>x.id===b.dataset.id);
        if(!e) return;
        const emptyIdx=state.traits.findIndex(t=>!t.title&&!t.text);
        const entry={title:e.nom.trim(), text:e.effet, level:parseInt((e.niveau||'N1').replace('N','')), levelType:'bonus', locked:false};
        if(emptyIdx!==-1) state.traits[emptyIdx]=entry; else state.traits.push(entry);
        if(typeof renderTraits==='function') renderTraits();
        if(typeof saveState==='function') saveState();
        b.disabled = true; b.style.opacity='.4'; b.textContent = '✓ ' + b.textContent;
      });
    });
  }
  let _octogoneCustomAEnvoyer = null;

  async function envoyerEffetsCombat(targetId, palier, canaux, palierAdv, effetsNommes, octogoneCustom){
    const effets=EFFETS_COMBAT[palier];
    try{
      const r=await fetch(`${SUPABASE_URL}/rest/v1/fiches?id=eq.${encodeURIComponent(targetId)}&select=etat`,
        {headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY}});
      const d=await r.json();
      const targetEtat=d[0]?.etat||{};
      targetEtat._combatEffectRequest={
        from:FICHE_ID, palier,
        effets:{des:effets.des, traitLevel:effets.traitLevel, traitDuree:effets.traitDuree, jetons:effets.jetons},
        canaux, palierAdv: palierAdv||null,
        effetsNommes: (effetsNommes||[]).map(e=>({id:e.id, nom:e.nom.trim(), effet:e.effet, niveau:e.niveau})),
        octogoneCustom: octogoneCustom||null,
        ts:Date.now()
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
    }[c])).filter(Boolean).join(', ');
    const txtNommes = (req.effetsNommes||[]).map(e=>e.nom).join(', ');
    const txtOctogone = req.octogoneCustom
      ? `${req.octogoneCustom.quantite} jeton(s) ${req.octogoneCustom.polarite==='pur'?'pur(s)':'dévoyé(s)'} sur ${SECTORS.find(s=>s.id===req.octogoneCustom.segment)?.label||req.octogoneCustom.segment}`
      : '';
    box.innerHTML=`<div style="font-family:Cinzel,serif;font-size:.75rem;color:#8b2020;margin-bottom:.4rem;">⚔ ${req.from} vous inflige les effets d'un combat (palier ${req.palier})</div>`
      +`<div style="margin-bottom:.4rem;">${[txt,txtOctogone].filter(Boolean).join(' · ')||'(aucun canal générique sélectionné)'}</div>`
      +(txtNommes?`<div style="margin-bottom:.6rem;font-style:italic;">+ ${txtNommes}</div>`:'')
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
      });
      if(req.octogoneCustom){
        const {segment, polarite, quantite} = req.octogoneCustom;
        for(let i=0;i<(quantite||1);i++) addToken(segment, polarite==='pur'?'white':'black');
      }
      (req.effetsNommes||[]).forEach(e=>{
        const emptyIdx=state.traits.findIndex(t=>!t.title&&!t.text);
        const entry={title:e.nom, text:e.effet+` (infligé par ${req.from})`, level:parseInt((e.niveau||'N1').replace('N','')), levelType:'malus', locked:false};
        if(emptyIdx!==-1) state.traits[emptyIdx]=entry; else state.traits.push(entry);
      });
      if((req.effetsNommes||[]).length && typeof renderTraits==='function') renderTraits();
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
    try{ installerHookRollResolu(); } catch(e){ console.error('[sifhr-combat-mode] installerHookRollResolu a échoué :', e); }
    try{ installerHookEtatsMobilisables(); } catch(e){ console.error('[sifhr-combat-mode] installerHookEtatsMobilisables a échoué :', e); }
    try{ installerHookTraitEngage(); } catch(e){ console.error('[sifhr-combat-mode] installerHookTraitEngage a échoué :', e); }
    try{ installerHookProuesseProdigePneuma(); } catch(e){ console.error('[sifhr-combat-mode] installerHookProuesseProdigePneuma a échoué :', e); }
    try{ demarrerRafraichissementSession(); } catch(e){ console.error('[sifhr-combat-mode] demarrerRafraichissementSession a échoué :', e); }
    try{ chargerCatalogue(); } catch(e){ console.error('[sifhr-combat-mode] chargerCatalogue a échoué :', e); }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
