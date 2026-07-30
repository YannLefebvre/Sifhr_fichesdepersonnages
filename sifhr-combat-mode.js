/* ============================================================
   SIFHR — MODE COMBAT (module additif)
   ------------------------------------------------------------
   Ce fichier ne modifie AUCUNE fonction existante d'octogone.html.
   Il s'appuie sur les objets/fonctions globaux déjà exposés par
   la fiche : state, dS(), FICHE_ID, SUPABASE_URL, SUPABASE_KEY,
   SECTORS, addToken(), saveState(), getBaseUrl(),
   dShowAdversaireResult(), _duelTargetId.

   Installation : ajouter juste avant </body>, APRÈS le dernier
   <script> existant :
     <script src="sifhr-combat-mode.js"></script>
   Et déposer sifhr_armes_manoeuvres.json dans le même dossier
   qu'octogone.html.
   ============================================================ */
(function(){
  'use strict';

  // ── 1. Chargement du catalogue externe (bibliothèque commune) ──
  let CATALOGUE = null;
  async function chargerCatalogue(){
    if(CATALOGUE) return CATALOGUE;
    try{
      const r = await fetch(getBaseUrl()+'sifhr_armes_manoeuvres.json');
      CATALOGUE = await r.json();
    }catch(e){
      console.error('[combat-mode] Impossible de charger le catalogue armes/manœuvres', e);
      CATALOGUE = {armes:[], manoeuvres:[], familles:{}};
    }
    return CATALOGUE;
  }

  // ── 2. État du combat (ajouté à state, sérialisé comme le reste) ──
  function ensureCombatState(){
    if(!window.state) return null;
    if(!state.combat){
      state.combat = {
        actif: false,
        armeId: null,
        manoeuvreId: null,
        bonusManuel: 0,
        engagement: null // 'moi' | 'adversaire' | null — tranché narrativement par le meneur
      };
    }
    return state.combat;
  }

  // ── 3. Table de résolution (Partie A du document de référence) ──
  const EFFETS_COMBAT = {
    benin:  { label:'Bénin (N1)',  des:1, traitLevel:1, traitDuree:'Temporaire (assaut/scène)', jetons:1 },
    moyen:  { label:'Moyen (N2)',  des:2, traitLevel:2, traitDuree:'Permanent (jusqu\'au soin)', jetons:2 },
    grave:  { label:'Grave (N3)',  des:3, traitLevel:3, traitDuree:'Permanent',                  jetons:3 },
  };
  const ORDRE_PALIERS = [null,'benin','moyen','grave'];

  function palierDeMarge(marge){
    if(marge<=0) return null;
    if(marge===1) return 'benin';
    if(marge<=4) return 'moyen';
    return 'grave';
  }
  function monterPalier(palier, crans){
    let idx = ORDRE_PALIERS.indexOf(palier);
    if(idx<0) idx=0;
    idx = Math.min(idx+crans, ORDRE_PALIERS.length-1);
    return ORDRE_PALIERS[idx];
  }

  function getArmeBonus(armeId){
    const c = ensureCombatState();
    if(!CATALOGUE || !armeId) return 0;
    const arme = CATALOGUE.armes.find(a=>a.id===armeId);
    if(!arme || !arme.ctp) return 0;
    // Bonus simple = somme du profil C/T/P divisée par 2, arrondi — reflète
    // l'ajout à la marge finale déjà prévu dans Sifhr_combats (l'arme s'ajoute).
    const {c:cc,t:tt,p:pp} = arme.ctp;
    return Math.round(((cc||0)+(tt||0)+(pp||0))/2);
  }

  // ── 4. Résolution automatique après comparaison des deux lancers ──
  // On "monkey-patch" dShowAdversaireResult SANS toucher à son code :
  // on appelle la version d'origine, puis notre logique de combat.
  function installerHookDuel(){
    if(typeof window.dShowAdversaireResult !== 'function') { setTimeout(installerHookDuel, 500); return; }
    if(window.dShowAdversaireResult.__sifhrCombatWrapped) return;
    const original = window.dShowAdversaireResult;
    const wrapped = function(result, pid){
      original(result, pid);
      try{
        const c = ensureCombatState();
        if(c && c.actif) dResoudreCombat(state.duelResult, result, pid);
      }catch(e){ console.error('[combat-mode] dResoudreCombat error', e); }
    };
    wrapped.__sifhrCombatWrapped = true;
    window.dShowAdversaireResult = wrapped;
  }

  function dResoudreCombat(myResult, advResult, advId){
    if(!myResult || !advResult) return;
    const c = ensureCombatState();

    const margeA = myResult.verdict==='echec_critique' ? -(myResult.oppositions||0) : (myResult.reussites||0);
    const margeB = advResult.verdict==='echec_critique' ? -(advResult.oppositions||0) : (advResult.reussites||0);

    const bonusArme = getArmeBonus(c.armeId);
    const margeFinale = (margeA + bonusArme + (c.bonusManuel||0)) - margeB;

    let palier = palierDeMarge(margeFinale);
    let cumulTout = false;
    if(margeFinale>0){
      if(myResult.tokensAcquis && myResult.traitNom){ /* signal faible, ignoré */ }
    }
    // Détection Prouesse / Prodige côté vainqueur (nous), via les classes
    // déjà posées par le lanceur sur .dsuccess-opposition
    const jePorteProuesse = !!document.querySelector('.dsuccess-opposition.prouesse');
    const jePorteProdige  = !!document.querySelector('.dsuccess-opposition.prodige');
    if(margeFinale>0 && jePorteProdige){ palier = monterPalier(palier,2); cumulTout = true; }
    else if(margeFinale>0 && jePorteProuesse){ palier = monterPalier(palier,1); }

    // Échec critique de l'adversaire : effet Octogone automatique de SON propre palier
    if(advResult.verdict==='echec_critique'){
      const palierAdv = palierDeMarge(Math.abs(advResult.oppositions||0));
      if(palierAdv) afficherPanneauResolution(palier, margeFinale, advId, cumulTout, {auto:true, palierAdv});
      else if(palier) afficherPanneauResolution(palier, margeFinale, advId, cumulTout, null);
    } else if(palier){
      afficherPanneauResolution(palier, margeFinale, advId, cumulTout, null);
    }
  }

  // ── 5. Panneau de choix des effets (le vainqueur peut désélectionner) ──
  function afficherPanneauResolution(palier, marge, advId, cumulTout, autoOctogone){
    if(!palier) return;
    const effets = EFFETS_COMBAT[palier];
    let panel = document.getElementById('combat-resolution-panel');
    if(!panel){
      panel = document.createElement('div');
      panel.id = 'combat-resolution-panel';
      panel.style.cssText = 'margin-top:.6rem;padding:.6rem .8rem;border:1px solid #8b2020;'
        +'border-radius:7px;background:rgba(139,32,32,.06);font-family:Crimson Text,serif;font-size:.85rem;';
      const box = document.getElementById('dfb-content') || document.getElementById('duel-feedback-box');
      (box||document.body).appendChild(panel);
    }
    const canaux = [
      {key:'des', label:`Dés dévoyés (${effets.des}) imposés au prochain lancer de ${advId}`},
      {key:'trait', label:`Trait de blessure niveau ${effets.traitLevel} (${effets.traitDuree})`},
      {key:'jetons', label:`${effets.jetons} jeton(s) dévoyé(s) dans l'octogone de ${advId}`},
    ];
    let html = `<div style="font-family:Cinzel,serif;font-size:.72rem;color:#8b2020;letter-spacing:.05em;margin-bottom:.4rem;">`
      +`⚔ RÉSOLUTION DU COMBAT — marge ${marge>=0?'+':''}${marge}, palier ${effets.label}</div>`;
    canaux.forEach(ca=>{
      const checked = cumulTout ? 'checked' : (ca.key==='des' ? 'checked' : '');
      html += `<label style="display:block;margin:.25rem 0;cursor:pointer;">`
        +`<input type="checkbox" class="combat-canal-cb" data-canal="${ca.key}" ${checked}> ${ca.label}</label>`;
    });
    if(autoOctogone){
      html += `<div style="margin-top:.4rem;font-style:italic;color:#8b2020;">`
        +`Échec critique adverse : 1 jeton supplémentaire dévoyé automatiquement dans son octogone (palier ${autoOctogone.palierAdv}).</div>`;
    }
    html += `<button id="combat-envoyer-effets-btn" style="margin-top:.5rem;font-family:Cinzel,serif;font-size:.72rem;`
      +`padding:5px 12px;border:1px solid #8b2020;border-radius:5px;background:#8b2020;color:#fff;cursor:pointer;">`
      +`Envoyer les effets à ${advId}</button>`;
    panel.innerHTML = html;
    document.getElementById('combat-envoyer-effets-btn').addEventListener('click', ()=>{
      const choix = Array.from(panel.querySelectorAll('.combat-canal-cb'))
        .filter(cb=>cb.checked).map(cb=>cb.dataset.canal);
      envoyerEffetsCombat(advId, palier, choix, autoOctogone);
      panel.innerHTML += `<div style="margin-top:.4rem;color:#1a4a2a;">✓ Effets envoyés — en attente de confirmation par ${advId}.</div>`;
    });
  }

  // ── 6. Envoi de la requête d'effet vers la fiche adverse (même schéma que xferSend) ──
  async function envoyerEffetsCombat(targetId, palier, canaux, autoOctogone){
    const effets = EFFETS_COMBAT[palier];
    try{
      const r = await fetch(`${SUPABASE_URL}/rest/v1/fiches?id=eq.${encodeURIComponent(targetId)}&select=etat`,
        {headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY}});
      const d = await r.json();
      const targetEtat = d[0]?.etat || {};
      targetEtat._combatEffectRequest = {
        from: FICHE_ID,
        palier, effets: {des:effets.des, traitLevel:effets.traitLevel, traitDuree:effets.traitDuree, jetons:effets.jetons},
        canaux,
        autoOctogone: autoOctogone||null,
        ts: Date.now()
      };
      await fetch(`${SUPABASE_URL}/rest/v1/fiches`,{
        method:'POST',
        headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},
        body: JSON.stringify({id:targetId, etat:targetEtat})
      });
    }catch(e){ console.error('[combat-mode] envoiEffetsCombat error', e); }
  }

  // ── 7. Réception côté cible : notification + acceptation (même esprit que xferAccept/xferRefuse) ──
  let _combatPending = null;
  let _combatLastSeenTs = 0;
  function afficherNotifCombat(req){
    _combatPending = req;
    const effets = req.effets;
    let box = document.getElementById('combat-notif-box');
    if(!box){
      box = document.createElement('div');
      box.id = 'combat-notif-box';
      box.style.cssText = 'position:fixed;bottom:14px;left:14px;right:14px;max-width:420px;margin:0 auto;'
        +'z-index:9999;background:#fff8f0;border:2px solid #8b2020;border-radius:8px;padding:.8rem 1rem;'
        +'font-family:Crimson Text,serif;font-size:.9rem;box-shadow:0 4px 18px rgba(0,0,0,.25);';
      document.body.appendChild(box);
    }
    let canauxTxt = req.canaux.map(c=>({
      des:`${effets.des} dé(s) dévoyé(s) au prochain lancer`,
      trait:`un Trait de blessure niveau ${effets.traitLevel} (${effets.traitDuree})`,
      jetons:`${effets.jetons} jeton(s) dévoyé(s) dans l'octogone`
    }[c])).join(', ');
    box.innerHTML = `<div style="font-family:Cinzel,serif;font-size:.75rem;color:#8b2020;margin-bottom:.4rem;">⚔ ${req.from} vous inflige les effets d'un combat (palier ${req.palier})</div>`
      + `<div style="margin-bottom:.6rem;">${canauxTxt||'(aucun canal sélectionné)'}</div>`
      + `<button id="combat-accept-btn" style="font-family:Cinzel,serif;font-size:.72rem;padding:4px 10px;margin-right:.5rem;border:1px solid #1a4a2a;border-radius:5px;background:#1a4a2a;color:#fff;cursor:pointer;">Accepter</button>`
      + `<button id="combat-refuse-btn" style="font-family:Cinzel,serif;font-size:.72rem;padding:4px 10px;border:1px solid var(--border,#b8a88a);border-radius:5px;background:none;cursor:pointer;">Refuser (à trancher avec le meneur)</button>`;
    document.getElementById('combat-accept-btn').addEventListener('click', ()=>appliquerEffetsCombat(req, true));
    document.getElementById('combat-refuse-btn').addEventListener('click', ()=>appliquerEffetsCombat(req, false));
  }

  function appliquerEffetsCombat(req, accepte){
    const box = document.getElementById('combat-notif-box');
    if(accepte){
      const effets = req.effets;
      req.canaux.forEach(canal=>{
        if(canal==='des'){
          const s = dS();
          s.reds = (s.reds||0) + effets.des;
        }
        if(canal==='trait'){
          const emptyIdx = state.traits.findIndex(t=>!t.title && !t.text);
          const entry = {
            title: `Blessure (${req.from})`,
            text: `Infligée en combat par ${req.from} — palier ${req.palier}.`,
            level: effets.traitLevel, levelType: 'malus', locked:false
          };
          if(emptyIdx!==-1) state.traits[emptyIdx]=entry; else state.traits.push(entry);
          if(typeof renderTraits==='function') renderTraits();
        }
        if(canal==='jetons'){
          // Segment par défaut : Terre/Bile Noire (ancrage/mélancolie), cohérent
          // avec la logique de blessure physique du système. Le joueur peut
          // ensuite déplacer manuellement le jeton si le meneur préfère un autre axe.
          for(let i=0;i<effets.jetons;i++) addToken('terre','black');
        }
      });
      if(req.autoOctogone){
        addToken('feu','black'); // saturation par défaut liée à l'échec critique (colère/frustration)
      }
      saveState();
    }
    if(box) box.remove();
    _combatPending = null;
  }

  async function pollerEffetsEntrants(){
    try{
      const r = await fetch(`${SUPABASE_URL}/rest/v1/fiches?id=eq.${encodeURIComponent(FICHE_ID)}&select=etat`,
        {headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY}});
      const d = await r.json();
      const req = d[0]?.etat?._combatEffectRequest;
      if(req && req.ts!==_combatLastSeenTs && !_combatPending){
        _combatLastSeenTs = req.ts;
        afficherNotifCombat(req);
      }
    }catch(e){ /* silencieux : ne pas gêner l'app si hors-ligne */ }
    setTimeout(pollerEffetsEntrants, 5000);
  }

  // ── 8. UI de préparation (arme / manœuvre / engagement) dans le panneau duel ──
  async function installerPanneauPreparation(){
    const hote = document.getElementById('dice-duel-setup');
    if(!hote){ setTimeout(installerPanneauPreparation, 800); return; }
    if(document.getElementById('combat-prepa-panel')) return;

    const cat = await chargerCatalogue();
    const c = ensureCombatState();

    const wrap = document.createElement('div');
    wrap.id = 'combat-prepa-panel';
    wrap.style.cssText = 'margin-top:.5rem;padding:.5rem .7rem;border:1px dashed #8b2020;border-radius:6px;';

    const armesOptions = cat.armes.map(a=>`<option value="${a.id}">${a.nom}${a.familleLabel?(' — '+a.familleLabel):''}</option>`).join('');
    const manOptions = cat.manoeuvres.map(m=>`<option value="${m.id}">${m.nom} (${m.niveau||'?'})</option>`).join('');

    wrap.innerHTML = `
      <label style="font-family:Cinzel,serif;font-size:.72rem;color:#8b2020;">
        <input type="checkbox" id="combat-mode-toggle"> Mode Combat pour cette épreuve
      </label>
      <div id="combat-mode-fields" style="display:none;margin-top:.4rem;">
        <select id="combat-arme-select" style="width:100%;margin-bottom:.3rem;font-size:.8rem;">
          <option value="">— Choisir une arme —</option>${armesOptions}
        </select>
        <select id="combat-manoeuvre-select" style="width:100%;margin-bottom:.3rem;font-size:.8rem;">
          <option value="">— Choisir une manœuvre (facultatif) —</option>${manOptions}
        </select>
        <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.3rem;">
          <label style="font-size:.75rem;">Bonus/malus meneur</label>
          <input type="number" id="combat-bonus-input" value="0" min="-3" max="3" style="width:55px;">
        </div>
        <div style="font-size:.72rem;color:var(--ink3,#666);">
          Engagement (narratif, tranché par le meneur) :
          <select id="combat-engagement-select" style="font-size:.75rem;">
            <option value="">Indéterminé</option>
            <option value="moi">Je l'ai</option>
            <option value="adversaire">L'adversaire l'a</option>
          </select>
        </div>
      </div>`;
    hote.appendChild(wrap);

    document.getElementById('combat-mode-toggle').addEventListener('change', (e)=>{
      c.actif = e.target.checked;
      document.getElementById('combat-mode-fields').style.display = c.actif ? 'block' : 'none';
    });
    document.getElementById('combat-arme-select').addEventListener('change', e=>{ c.armeId = e.target.value||null; });
    document.getElementById('combat-manoeuvre-select').addEventListener('change', e=>{ c.manoeuvreId = e.target.value||null; });
    document.getElementById('combat-bonus-input').addEventListener('change', e=>{ c.bonusManuel = parseInt(e.target.value)||0; });
    document.getElementById('combat-engagement-select').addEventListener('change', e=>{ c.engagement = e.target.value||null; });
  }

  // ── 9. Amorçage ──
  function init(){
    ensureCombatState();
    installerHookDuel();
    installerPanneauPreparation();
    pollerEffetsEntrants();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
