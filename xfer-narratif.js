// ════════════════════════════════════════════════════════════
// Descriptifs narratifs des transferts de jetons — Octogone
// Dépend de EH_DATA (elements-humeurs-data.js) et de SECTORS
// (défini dans octogone.html) pour le mapping secteur → élément.
// ════════════════════════════════════════════════════════════

// Table de correspondance entre l'id de secteur (SECTORS[].id)
// et la clé utilisée dans EH_DATA.
const XFER_ELEMENT_KEY = {
  feu: 'feu',
  bile_j: 'bile_jaune',
  terre: 'terre',
  bile_n: 'bile_noire',
  eau: 'eau',
  flegme: 'flegme',
  air: 'air',
  sang: 'sang'
};

// ────────────────────────────────────────────────────────────
// Modalités par élément. Chaque modalité est une fonction qui
// reçoit {from, to} (noms des personnages) et retourne une
// phrase narrative décrivant le geste de transmission.
// Plusieurs variantes par élément/couleur pour éviter la
// répétition d'une fiche à l'autre — une est choisie au hasard
// d'une manière stable (basée sur from+to+sectorId) pour qu'un
// même couple de personnages garde une cohérence si on rejoue
// la scène, sans pour autant être strictement déterministe
// entre éléments différents.
// ────────────────────────────────────────────────────────────

const XFER_MODALITIES = {

  feu: {
    white: [ // force
      (f,t) => `${f} pose une main ferme sur l'épaule de ${t}, et cette poigne suffit à transmettre une détermination tranquille.`,
      (f,t) => `D'un ordre lancé sans détour, ${f} insuffle à ${t} l'élan de se redresser et d'agir.`,
      (f,t) => `${f} empoigne le bras de ${t} un bref instant — un geste sec, presque martial, qui dit tout ce que les mots auraient alourdi.`
    ],
    black: [ // envie
      (f,t) => `${f} darde sur ${t} un regard dur, presque accusateur, et quelque chose de brûlant s'installe entre eux.`,
      (f,t) => `D'une provocation à peine voilée, ${f} pousse ${t} dans ses retranchements.`,
      (f,t) => `${f} laisse échapper un mot cinglant à l'adresse de ${t}, comme une étincelle jetée volontairement sur de la poudre.`
    ]
  },

  bile_jaune: {
    white: [ // charité
      (f,t) => `${f} tend la main vers ${t} et lui offre quelque chose — un objet, un geste, une parole — sans rien attendre en retour.`,
      (f,t) => `D'une parole de réconfort murmurée à ${t}, ${f} allège un fardeau qui n'était pourtant pas le sien à porter.`,
      (f,t) => `${f} pose doucement la main sur celle de ${t}, un contact bref mais sincère.`
    ],
    black: [ // luxure
      (f,t) => `${f} adresse à ${t} un sourire enjôleur, un regard qui s'attarde un peu trop longtemps.`,
      (f,t) => `D'un effleurement qui n'a rien d'innocent, ${f} trouble la contenance de ${t}.`,
      (f,t) => `${f} glisse à l'oreille de ${t} quelques mots à double sens, savourant le trouble qu'ils provoquent.`
    ]
  },

  terre: {
    white: [ // loyauté
      (f,t) => `${f} serre fermement la main de ${t}, scellant sans un mot une promesse tacite.`,
      (f,t) => `${f} retire son bracelet de la Macchina et le referme un instant sur le poignet de ${t}, comme pour sceller un pacte.`,
      (f,t) => `D'un serment murmuré, à peine audible, ${f} engage sa parole envers ${t}.`
    ],
    black: [ // malignité
      (f,t) => `${f} adresse à ${t} un sourire trop aimable pour être honnête.`,
      (f,t) => `D'une parole insidieuse glissée à l'oreille de ${t}, ${f} sème un doute qui ne demande qu'à grandir.`,
      (f,t) => `${f} feint la sollicitude envers ${t}, mais quelque chose dans son regard trahit une tout autre intention.`
    ]
  },

  bile_noire: {
    white: [ // prudence
      (f,t) => `${f} échange avec ${t} un regard entendu, le genre qui n'a besoin d'aucun mot pour avertir.`,
      (f,t) => `D'un conseil chuchoté, presque inaudible, ${f} met ${t} en garde.`,
      (f,t) => `${f} et ${t} partagent un instant de silence appuyé, lourd de sous-entendus prudents.`
    ],
    black: [ // acédie
      (f,t) => `${f} détourne le regard de ${t} dans un soupir, une indifférence qui pèse plus qu'un reproche.`,
      (f,t) => `D'un geste résigné, ${f} laisse tomber quelque chose entre lui et ${t} — une intention, peut-être, qui ne reviendra pas.`,
      (f,t) => `${f} hausse les épaules face à ${t}, comme si plus rien ne valait la peine d'être tenté.`
    ]
  },

  eau: {
    white: [ // tempérance
      (f,t) => `${f} pose une main apaisante sur le bras de ${t}, et la tension retombe d'un cran.`,
      (f,t) => `${f} et ${t} respirent un instant ensemble, en silence, dans une forme de méditation partagée.`,
      (f,t) => `D'une parole posée, presque égale, ${f} ramène ${t} vers un calme retrouvé.`
    ],
    black: [ // lâcheté
      (f,t) => `${f} esquive le regard de ${t} et recule d'un pas, comme malgré lui.`,
      (f,t) => `D'un mot avalé avant d'être prononcé, ${f} laisse ${t} deviner ce qu'il n'a pas eu le courage de dire.`,
      (f,t) => `${f} se détourne de ${t} sans explication, fuyant ce qu'il aurait dû affronter.`
    ]
  },

  flegme: {
    white: [ // chasteté
      (f,t) => `${f} garde ses distances avec ${t}, mais sa présence calme suffit à transmettre une retenue rassurante.`,
      (f,t) => `D'une parole mesurée, choisie avec soin, ${f} s'adresse à ${t} sans jamais en dire trop.`,
      (f,t) => `${f} incline la tête vers ${t}, un salut sobre et sans ambiguïté.`
    ],
    black: [ // avarice
      (f,t) => `${f} jauge ${t} d'un regard calculateur, mesurant ce qu'il consent à céder.`,
      (f,t) => `D'une parole retenue à dessein, ${f} laisse ${t} comprendre qu'il n'obtiendra rien de plus.`,
      (f,t) => `${f} referme la main sur ce qu'il tenait, avant de finalement la rouvrir devant ${t} — à contrecœur.`
    ]
  },

  air: {
    white: [ // foi
      (f,t) => `${f} lève les yeux vers le ciel aux côtés de ${t}, et un instant de certitude silencieuse les unit.`,
      (f,t) => `${f} retire son bracelet de la Macchina et le tend à ${t}, comme pour faire passer une conviction qui n'a pas besoin de preuve.`,
      (f,t) => `D'une parole d'espoir murmurée, ${f} insuffle à ${t} la certitude que tout n'est pas perdu.`
    ],
    black: [ // félonie
      (f,t) => `${f} murmure à ${t} un mensonge enrobé de bonnes manières.`,
      (f,t) => `D'un regard fuyant, ${f} trahit à ${t} bien plus qu'il ne voudrait l'admettre.`,
      (f,t) => `${f} promet à ${t} quelque chose qu'il sait déjà ne pas vouloir tenir.`
    ]
  },

  sang: {
    white: [ // espérance
      (f,t) => `${f} serre ${t} contre lui un bref instant, une étreinte qui dit l'espoir mieux que n'importe quel mot.`,
      (f,t) => `${f} et ${t} partagent un chant murmuré, presque une méditation collective, qui les relie au-delà du moment présent.`,
      (f,t) => `D'une parole vibrante, ${f} redonne à ${t} une raison d'y croire encore.`
    ],
    black: [ // témérité
      (f,t) => `${f} lance à ${t} un défi du regard, une provocation à peine déguisée.`,
      (f,t) => `D'un geste brusque, presque imprudent, ${f} entraîne ${t} vers quelque chose qu'ils n'auraient peut-être pas dû tenter.`,
      (f,t) => `${f} pousse ${t} à agir sans attendre, sans peser les conséquences.`
    ]
  }
};

// ────────────────────────────────────────────────────────────
// Sélection stable d'une variante de modalité, pour qu'un même
// couple expéditeur/destinataire + secteur donne toujours la
// même phrase (cohérence narrative si la scène est revue).
// ────────────────────────────────────────────────────────────
function xferPickVariant(arr, seedStr){
  let h = 0;
  for (let i = 0; i < seedStr.length; i++){
    h = ((h << 5) - h + seedStr.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % arr.length;
  return arr[idx];
}

// ────────────────────────────────────────────────────────────
// Fonction principale : construit le descriptif narratif complet
// pour un transfert donné.
//
// params:
//   sectorId : id du secteur (ex: 'feu', 'bile_j', ...)
//   color    : 'white' | 'black'
//   score    : score du destinataire dans ce vice/vertu APRÈS
//              réception du jeton (1, 2 ou 3) — sert à choisir
//              le bon palier dans EH_DATA. Si non fourni, on
//              utilise 1 par défaut.
//   fromName : nom (ou identifiant) du personnage expéditeur
//   toName   : nom (ou identifiant) du personnage destinataire
//
// retourne : { modalite: string, signification: string } ou null
//            si les données ne sont pas trouvées.
// ────────────────────────────────────────────────────────────
function buildXferNarrative({sectorId, color, score, fromName, toName}){
  const elKey = XFER_ELEMENT_KEY[sectorId];
  if (!elKey || typeof EH_DATA === 'undefined' || !EH_DATA[elKey]) return null;

  const s = Math.max(1, Math.min(3, score || 1));
  const ehKey = color === 'white' ? `${s}b_0n` : `0b_${s}n`;
  const signification = EH_DATA[elKey][ehKey] || EH_DATA[elKey]['1b_0n'] || '';

  const modalSet = XFER_MODALITIES[elKey];
  let modalite = '';
  if (modalSet && modalSet[color] && modalSet[color].length){
    const variants = modalSet[color];
    const fn = xferPickVariant(variants, `${fromName}|${toName}|${sectorId}|${color}`);
    modalite = fn(fromName, toName);
  }

  return { modalite, signification };
}
