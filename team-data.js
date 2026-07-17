/* ===================================================================
   TEAM-DATA — table PARTAGÉE des équipes nationales (module sans build).
   Couvre la CDM 2026 (48) + les 54 nations UEFA (Ligue des Nations 2026-27).
   - window.TEAM_FR  : displayName ESPN (EN) → nom français
   - window.TEAM_ISO : nom français → code drapeau flagcdn
   Chargé AVANT les scripts de page ; fusion douce (les tables locales des
   pages complètent sans écraser → zéro régression).
   =================================================================== */
(function () {
  'use strict';

  var FR = {
    /* --- CDM 2026 (reprend la table la plus complète, variantes incluses) --- */
    'Mexico': 'Mexique', 'South Africa': 'Afrique du Sud', 'South Korea': 'Corée du Sud', 'Korea Republic': 'Corée du Sud',
    'Czech Republic': 'Tchéquie', 'Czechia': 'Tchéquie',
    'Canada': 'Canada', 'Bosnia and Herzegovina': 'Bosnie-Herzégovine', 'Bosnia & Herzegovina': 'Bosnie-Herzégovine',
    'Bosnia-Herzegovina': 'Bosnie-Herzégovine', 'Bosnia Herzegovina': 'Bosnie-Herzégovine',
    'Qatar': 'Qatar', 'Switzerland': 'Suisse',
    'Brazil': 'Brésil', 'Morocco': 'Maroc', 'Haiti': 'Haïti', 'Scotland': 'Écosse',
    'United States': 'États-Unis', 'USA': 'États-Unis', 'Paraguay': 'Paraguay', 'Australia': 'Australie',
    'Turkey': 'Turquie', 'Türkiye': 'Turquie',
    'Germany': 'Allemagne', 'Curacao': 'Curaçao', 'Curaçao': 'Curaçao',
    'Ivory Coast': "Côte d'Ivoire", 'Côte d’Ivoire': "Côte d'Ivoire", 'Ecuador': 'Équateur',
    'Netherlands': 'Pays-Bas', 'Japan': 'Japon', 'Sweden': 'Suède', 'Tunisia': 'Tunisie',
    'Belgium': 'Belgique', 'Egypt': 'Égypte', 'Iran': 'Iran', 'New Zealand': 'Nouvelle-Zélande',
    'Spain': 'Espagne', 'Cape Verde': 'Cap-Vert', 'Saudi Arabia': 'Arabie Saoudite', 'Uruguay': 'Uruguay',
    'France': 'France', 'Senegal': 'Sénégal', 'Iraq': 'Irak', 'Norway': 'Norvège',
    'Argentina': 'Argentine', 'Algeria': 'Algérie', 'Austria': 'Autriche', 'Jordan': 'Jordanie',
    'Portugal': 'Portugal', 'DR Congo': 'RD Congo', 'Congo DR': 'RD Congo', 'Uzbekistan': 'Ouzbékistan',
    'Colombia': 'Colombie', 'England': 'Angleterre', 'Croatia': 'Croatie', 'Ghana': 'Ghana', 'Panama': 'Panama',
    /* --- UEFA (Ligue des Nations 2026-27) — nouvelles nations --- */
    'Albania': 'Albanie', 'Andorra': 'Andorre', 'Armenia': 'Arménie', 'Azerbaijan': 'Azerbaïdjan',
    'Belarus': 'Biélorussie', 'Bulgaria': 'Bulgarie', 'Cyprus': 'Chypre', 'Denmark': 'Danemark',
    'Estonia': 'Estonie', 'Faroe Islands': 'Îles Féroé', 'Finland': 'Finlande', 'Georgia': 'Géorgie',
    'Gibraltar': 'Gibraltar', 'Greece': 'Grèce', 'Hungary': 'Hongrie', 'Iceland': 'Islande',
    'Israel': 'Israël', 'Italy': 'Italie', 'Kazakhstan': 'Kazakhstan', 'Kosovo': 'Kosovo',
    'Latvia': 'Lettonie', 'Liechtenstein': 'Liechtenstein', 'Lithuania': 'Lituanie', 'Luxembourg': 'Luxembourg',
    'Malta': 'Malte', 'Moldova': 'Moldavie', 'Montenegro': 'Monténégro', 'North Macedonia': 'Macédoine du Nord',
    'Northern Ireland': 'Irlande du Nord', 'Poland': 'Pologne', 'Republic of Ireland': 'Irlande', 'Ireland': 'Irlande',
    'Romania': 'Roumanie', 'San Marino': 'Saint-Marin', 'Serbia': 'Serbie', 'Slovakia': 'Slovaquie',
    'Slovenia': 'Slovénie', 'Ukraine': 'Ukraine', 'Wales': 'Pays de Galles'
  };

  var ISO = {
    /* CDM 2026 */
    'Mexique': 'mx', 'Afrique du Sud': 'za', 'Corée du Sud': 'kr', 'Tchéquie': 'cz',
    'Canada': 'ca', 'Bosnie-Herzégovine': 'ba', 'Qatar': 'qa', 'Suisse': 'ch',
    'Brésil': 'br', 'Maroc': 'ma', 'Haïti': 'ht', 'Écosse': 'gb-sct',
    'États-Unis': 'us', 'Paraguay': 'py', 'Australie': 'au', 'Turquie': 'tr',
    'Allemagne': 'de', 'Curaçao': 'cw', "Côte d'Ivoire": 'ci', 'Équateur': 'ec',
    'Pays-Bas': 'nl', 'Japon': 'jp', 'Suède': 'se', 'Tunisie': 'tn',
    'Belgique': 'be', 'Égypte': 'eg', 'Iran': 'ir', 'Nouvelle-Zélande': 'nz',
    'Espagne': 'es', 'Cap-Vert': 'cv', 'Arabie Saoudite': 'sa', 'Uruguay': 'uy',
    'France': 'fr', 'Sénégal': 'sn', 'Irak': 'iq', 'Norvège': 'no',
    'Argentine': 'ar', 'Algérie': 'dz', 'Autriche': 'at', 'Jordanie': 'jo',
    'Portugal': 'pt', 'RD Congo': 'cd', 'Ouzbékistan': 'uz', 'Colombie': 'co',
    'Angleterre': 'gb-eng', 'Croatie': 'hr', 'Ghana': 'gh', 'Panama': 'pa',
    /* UEFA (LdN) */
    'Albanie': 'al', 'Andorre': 'ad', 'Arménie': 'am', 'Azerbaïdjan': 'az',
    'Biélorussie': 'by', 'Bulgarie': 'bg', 'Chypre': 'cy', 'Danemark': 'dk',
    'Estonie': 'ee', 'Îles Féroé': 'fo', 'Finlande': 'fi', 'Géorgie': 'ge',
    'Gibraltar': 'gi', 'Grèce': 'gr', 'Hongrie': 'hu', 'Islande': 'is',
    'Israël': 'il', 'Italie': 'it', 'Kazakhstan': 'kz', 'Kosovo': 'xk',
    'Lettonie': 'lv', 'Liechtenstein': 'li', 'Lituanie': 'lt', 'Luxembourg': 'lu',
    'Malte': 'mt', 'Moldavie': 'md', 'Monténégro': 'me', 'Macédoine du Nord': 'mk',
    'Irlande du Nord': 'gb-nir', 'Pologne': 'pl', 'Irlande': 'ie', 'Roumanie': 'ro',
    'Saint-Marin': 'sm', 'Serbie': 'rs', 'Slovaquie': 'sk', 'Slovénie': 'si',
    'Ukraine': 'ua', 'Pays de Galles': 'gb-wls'
  };

  // fusion douce : ne JAMAIS écraser une entrée déjà posée par une page
  window.TEAM_FR = Object.assign(FR, window.TEAM_FR || {});
  window.TEAM_ISO = Object.assign(ISO, window.TEAM_ISO || {});
})();
