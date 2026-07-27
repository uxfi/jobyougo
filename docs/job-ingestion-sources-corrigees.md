# Sources d'ingestion jobs/remote/freelance - version corrigee

Derniere verification: 2026-06-14.

Le meilleur socle pour un pipeline d'ingestion fiable reste:

- APIs jobs/remote a integrer en premier: Remotive, RemoteOK, Jobicy, Arbeitnow.
- APIs avec cles a ajouter ensuite: Adzuna, Reed, Jooble, The Muse.
- RSS en complement: Jobicy RSS, We Work Remotely RSS, RemoteOK RSS/API selon usage, flux de job boards specialises quand disponibles.
- Europe: Adzuna, Reed UK, Arbeitnow Allemagne/Europe. EURES doit rester en verification dediee: le portail public repond, mais aucun endpoint jobs stable n'a ete confirme.
- Asie/Moyen-Orient: GulfTalent, Bayt, Naukrigulf, Wuzzuf, Wamda Jobs, JobsDB/SEEK, TokyoDev, Japan Dev, MyCareersFuture, NodeFlair. Les traiter comme sources partenariat/API/scraping autorise apres revue ToS, car les APIs publiques simples ne sont pas confirmees.
- Freelance marketplaces: Upwork, Freelancer, PeoplePerHour, Malt, Toptal, Contra, Fiverr. Priorite a API/partenariat/alertes/RSS si disponibles; eviter le scraping agressif.
- Connecteurs/MCP utiles: Apify MCP pour acteurs de scraping controle, Firecrawl MCP pour extraction web autorisee, Fetch/browser/search MCP pour verification ponctuelle, RSS parser/MCP pour flux. Jobicy expose aussi un MCP public.

## Priorite d'integration

| Priorite | Source | Zone | Type | Acces automatisable | Pourquoi |
|---|---|---|---|---|---|
| P0 | Remotive | Global remote | Remote jobs API | API JSON publique | Simple, remote-first, endpoint documente, attribution et lien source requis. Jobs retardes de 24h selon notice. |
| P0 | RemoteOK | Global remote | Remote jobs API | API JSON publique | Gros volume remote, endpoint public, attribution/lien retour a respecter. |
| P0 | Jobicy | Global remote | Remote jobs API/RSS/MCP | API JSON + RSS + MCP publics | Endpoint documente, filtres utiles, lien source requis. Delai de publication 6h, polling quelques fois/jour suffisant, max conseille une fois/heure. |
| P0 | Arbeitnow | Europe/Allemagne | Job board API | API JSON publique | Bon flux Europe tech/startup, endpoint public pagine. |
| P1 | Adzuna | Multi-pays | Agregateur API | API officielle avec `app_id`/`app_key` | Couverture internationale, bon point d'entree Europe/Asie/MENA selon pays disponibles. Verifier quotas et pays avant production. |
| P1 | Reed | UK/Europe | Job board API | API developpeur avec cle | Pertinent UK/Europe anglophone. |
| P1 | Jooble | Global | Agregateur API | API officielle avec cle | Bonne couverture internationale, mais acces, quotas et droits de redistribution doivent etre valides avant P1 effectif. |
| P1 | The Muse | Global, US-heavy | Company/jobs API | API developpeur | Donnees propres entreprises/jobs, surtout utile pour jobs/company intelligence; moins prioritaire pour freelance. |
| P2 | We Work Remotely | Global remote | Job board/RSS | RSS par categorie | Bon complement remote; moins structure qu'une API. |
| P2 | TokyoDev / Japan Dev / NodeFlair | Asie | Job boards niche | Scraping prudent / alertes / partenariat | Tres pertinents regionalement, mais pas d'API publique simple confirmee. |
| P2 | GulfTalent / Bayt / Naukrigulf / Wuzzuf | Moyen-Orient | Job boards regionaux | Scraping prudent / API partenaire | Bonne couverture MENA, mais ToS/API a verifier avant ingestion. |
| P3 | LinkedIn / Indeed / Glassdoor | Global | Grandes plateformes | A eviter sans accord/API partenaire | Robots/ToS restrictifs, risque eleve. |
| P3 | Upwork / Fiverr / Malt / Contra / Toptal | Freelance | Marketplaces | API/partenariat seulement | Valeur forte mais scraping risqué; privilegier integrations officielles. |

## APIs et flux directement exploitables

| Source | URL | Couverture | Freelance/remote | Acces | Gratuit/payant | Notes d'integration |
|---|---|---|---|---|---|---|
| Remotive | https://remotive.com/api-documentation | Global remote | Remote fort, freelance variable | JSON API | Gratuit avec attribution | Endpoint documente. Mentionner Remotive, conserver l'URL source, respecter le delai de 24h. |
| RemoteOK | https://remoteok.com/api | Global remote | Remote fort | JSON API | Gratuit avec attribution | Endpoint public. Prevoir attribution et lien retour follow vers RemoteOK selon conditions affichees. |
| Jobicy API | https://jobicy.com/jobs-rss-feed | Global remote | Remote fort | JSON API | Gratuit avec restrictions d'usage | `GET https://jobicy.com/api/v2/remote-jobs`. Limite `count` 1-100, filtres `geo`, `industry`, `tag`. Ne pas republier vers plateformes externes interdites; lien source requis. |
| Jobicy RSS | https://jobicy.com/feed/job_feed | Global remote | Remote fort | RSS | Gratuit avec restrictions d'usage | Bon pour ingestion simple et monitoring. Polling quelques fois/jour; ne pas depasser une fois/heure. Publication avec delai de 6h. |
| Jobicy MCP | https://jobicy.com/mcp | Global remote | Remote fort | MCP SSE | Gratuit avec restrictions d'usage | Utile pour agents/outillage interne; appeler les taxonomies avant filtrage strict. |
| Arbeitnow | https://www.arbeitnow.com/api/job-board-api | Allemagne/Europe | Remote partiel | JSON API | Gratuit | Endpoint pagine avec jobs, tags, remote/hybrid selon donnees. Tres bon P0 Europe. |
| Adzuna | https://developer.adzuna.com/ | Multi-pays | Variable | API officielle avec `app_id`/`app_key` | Freemium/cle requise | Bon agregateur international. Verifier pays supportes, quotas, couts et droits de redistribution avant prod. |
| Reed | https://www.reed.co.uk/developers/ | UK | Remote partiel | API developpeur | Cle/API | Pertinent UK/Europe anglophone. |
| The Muse | https://www.themuse.com/developers/api/v2 | Global, plutot US | Remote partiel | API developpeur | A verifier selon usage | Donnees propres entreprises/jobs. Moins prioritaire si l'objectif principal est freelance Europe/Asie/MENA. |
| Jooble API | https://jooble.org/api/about | Global | Variable | API officielle avec cle | Cle/API | A tester avec une vraie cle. Ne pas classer comme P0 tant que quotas et conditions de redistribution ne sont pas valides. |
| JSearch / RapidAPI | https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch | Global | Variable | API RapidAPI | Freemium/payant | Bien pour prototype, dependance commerciale et conformite a verifier. |

## Remote job boards avec RSS, pages structurees ou ingestion prudente

| Source | Zone | Acces | Pertinence | Notes |
|---|---|---|---|---|
| We Work Remotely | Global | RSS/pages | Tres forte remote | Flux par categories exploitables; respecter frequence basse. |
| Remote.co | Global | Pages | Forte remote | Pas d'API publique simple confirmee; scraping prudent ou monitoring manuel. |
| Himalayas | Global | Pages/API non confirmee dans cette verification | Forte remote | Bon signal remote; verifier API/RSS et ToS avant ingestion automatisée. |
| Working Nomads | Global | RSS/pages | Forte remote | Bon flux remote si RSS confirme pour les categories ciblees. |
| Dynamite Jobs | Global | Pages | Remote/freelance | Pertinent startup/remote; verifier ToS avant scraping. |
| Otta / Welcome to the Jungle | Europe/Global | Pages/partenariats | Remote partiel | Tres bon signal qualite, mais automatisation a valider legalement. |

## Europe

| Source | Pays/zone | Type | Acces | Pertinence | Notes |
|---|---|---|---|---|---|
| Arbeitnow | Allemagne/Europe | Job API | API JSON | Haute | P0 pour Europe tech/startup. |
| Reed | UK | Job API | API | Haute | P1 UK/Europe anglophone. |
| Adzuna | Europe multi-pays | Agregateur API | API avec cle | Haute | P1 si quotas et pays cibles valides. |
| EURES | UE | Portail public | API jobs non confirmee | Moyenne/haute | Source officielle UE, mais l'ancienne URL testee renvoie 404. Utiliser d'abord en recherche/verification, pas comme connecteur API production. |
| Welcome to the Jungle | France/Europe | Job board | API publique non confirmee | Haute qualite | Scraping prudent / partenariat. |
| EuroJobs | Europe | Job board | RSS/pages a verifier | Moyenne | Bon complement, verifier fraicheur et ToS. |
| No Fluff Jobs | Europe centrale/tech | Job board | API/RSS non confirmee | Haute tech | Tres utile tech remote/hybrid; automatisation a valider. |
| Landing.jobs | Europe/Portugal | Job board | Pages | Moyenne | Bon signal tech Europe. |
| Jobbatical | Europe/global mobility | Job board | Pages | Niche | Plus relocation/global mobility que freelance. |

## Asie

| Source | Zone | Type | Acces | Pertinence | Notes |
|---|---|---|---|---|---|
| JobsDB / SEEK Asia | Hong Kong, Thailande, Asie | Job board | API publique non confirmee | Haute | Verifier partenariat/API; scraping prudent. |
| MyCareersFuture | Singapour | Portail national | API publique non confirmee | Moyenne | Bon signal local, moins freelance. |
| NodeFlair | Singapour/Asie tech | Job board | Pages | Haute tech | Tres pertinent tech/remote regional; verifier ToS. |
| TokyoDev | Japon tech anglophone | Job board | Pages/RSS a verifier | Haute niche | Bon pour jobs dev Japon/remote-friendly. |
| Japan Dev | Japon tech anglophone | Job board | Pages/RSS a verifier | Haute niche | Bon complement TokyoDev. |
| Wantedly | Japon/Asie | Plateforme jobs | API partenaire possible | Moyenne | Automatisation a valider. |
| Tech in Asia Jobs | Asie startup | Job board | Pages | Moyenne | Verifier etat/volume actuel avant pipeline. |

## Moyen-Orient / MENA

| Source | Zone | Type | Acces | Pertinence | Notes |
|---|---|---|---|---|---|
| Bayt | MENA | Job board | API/partenariat non confirme | Haute | Gros volume regional; eviter scraping sans accord. |
| GulfTalent | GCC/MENA | Job board | API non confirmee | Haute | Bon signal senior/professionnel. |
| Naukrigulf | GCC | Job board | API non confirmee | Haute | Bon volume GCC. |
| Wuzzuf | Egypte/MENA | Job board | API non confirmee | Moyenne/haute | Bon pour Egypte/MENA startup. |
| Wamda Jobs | MENA startups | Job board | Pages | Moyenne | Pertinent startup/tech, volume a verifier. |
| Akhtaboot | Jordan/MENA | Job board | Pages/API non confirmee | Moyenne | Complement regional. |

## Freelance marketplaces

| Source | Zone | Acces recommande | Pertinence freelance | Risque automatisation |
|---|---|---|---|---|
| Upwork | Global | API/partenariat uniquement | Tres haute | Eleve: acces protege/Cloudflare, ne pas scraper. |
| Freelancer.com | Global | API/partenariat ou pages permises uniquement | Haute | Moyen/eleve: robots interdit plusieurs routes jobs/search. |
| Fiverr | Global | API/partenariat | Haute | Eleve pour scraping offres/gigs; routes search/gigs largement restreintes. |
| Malt | Europe | API/partenariat | Haute Europe | Eleve: acces protege/Cloudflare observe, marketplace fermee. |
| PeoplePerHour | Europe/global | API/partenariat ou sitemaps/flux autorises | Moyenne/haute | A verifier; robots bloque plusieurs routes dynamiques. |
| Contra | Global remote | Pages/partenariat | Haute creatifs/indes | A verifier. |
| Toptal | Global | Partenariat | Haute premium | Scraping deconseille. |

## Sources a eviter ou a traiter seulement via accord/API officielle

- LinkedIn Jobs: robots.txt indique que l'acces automatise sans permission expresse est interdit; plusieurs routes jobs sont disallow (`/jobs?runSearch*`, `/jobs-guest/`, `/api/jobPostings/jobs*`, `/jsearch*`). Ne pas scraper.
- Indeed: robots.txt bloque de nombreuses routes jobs/API/RSS (`/*?rss`, `/api/getrecjobs`, `/jobs/...`, etc.). Ne pas scraper sans autorisation.
- Glassdoor: robots.txt bloque `jobview`, `search`, `rss`, `developer` et API routes. Eviter sans accord.
- Freelancer.com: robots.txt bloque plusieurs routes `/jobs/?*`, `/work/*`, `/find/*`, `/projects/browse.php*`. Prudence elevee.
- Upwork: `robots.txt` renvoie un challenge Cloudflare/403 depuis la verification. Traiter comme acces protege, pas comme source scrape-first.
- Malt: `robots.txt` renvoie un challenge Cloudflare depuis la verification. Traiter comme acces protege.

## Connecteurs et MCP possibles

| Connecteur | Usage | Pertinence | Notes |
|---|---|---|---|
| Jobicy MCP | Rechercher les jobs Jobicy via MCP public | Haute | Directement documente par Jobicy. Bon pour agent interne, pas necessaire si API/RSS suffit. |
| Apify MCP | Lancer des acteurs Apify pour scraping controle | Haute | Utile pour sources sans API, avec frequence basse et respect ToS. |
| Firecrawl MCP | Crawl/extraction web | Moyenne/haute | Utile pour prototypes et sites autorises; attention aux ToS. |
| Fetch/browser/search MCP | Verifier pages et extraire HTML ponctuellement | Moyenne | Bon pour enrichissement ponctuel, pas ingestion massive. |
| RSS parser/MCP | Ingestion RSS | Haute | Ideal pour Jobicy, WWR, Working Nomads et autres flux. |
| RapidAPI | Acces a JSearch/autres APIs jobs | Moyenne | Rapide pour prototype, dependance commerciale; verifier couts et droits de redistribution. |
| API directes custom | Remotive, RemoteOK, Jobicy, Arbeitnow, Adzuna, Reed | Tres haute | Recommande pour V1 stable. |

## Proposition de pipeline V1 corrigee

### Ingestion P0 API/RSS

- Remotive API
- RemoteOK API
- Jobicy API/RSS
- Arbeitnow API

### Ingestion P1 avec cles

- Adzuna API
- Reed API
- Jooble API apres validation de cle, quotas et redistribution
- The Muse API si les donnees company/jobs sont utiles au produit

### Normalisation

Champs communs:

- `source`
- `source_url`
- `source_job_id`
- `title`
- `company`
- `location`
- `region`
- `remote_type`
- `contract_type`
- `salary`
- `tags`
- `published_at`
- `apply_url`
- `description`
- `ingested_at`
- `license_notes`
- `attribution_required`

### Controles qualite

- Deduplication par `company + title + location + source_url`.
- Filtre remote/freelance explicite: remote, hybrid, freelance, contractor, contract, consultant.
- Score geographique: Europe / Asia / Middle East / global remote.
- Conservation des contraintes de licence par source: attribution, lien retour, delai de publication, frequence de polling, redistribution interdite.

### Sources P2/P3

- Ajouter seulement apres revue ToS et test robots.
- Pour scraping autorise: frequence basse, cache, attribution, pas de contournement login/CAPTCHA/Cloudflare.
- Pour plateformes protegees: partenariat/API officielle uniquement.

## Recommandation finale

Pour avancer vite sans risque legal inutile, construire le premier prototype autour de Remotive + RemoteOK + Jobicy + Arbeitnow + Adzuna + Reed.

Ajouter Jooble uniquement apres validation de l'acces API, des quotas et des droits de redistribution. Completer MENA/Asie avec Apify/Firecrawl ou des connecteurs dedies seulement apres revue des conditions des sites cibles. Ne pas utiliser LinkedIn, Indeed, Glassdoor, Upwork, Malt ou Fiverr comme sources scrape-first.

## Verifications effectuees

Sources confirmees:

- Remotive API: https://remotive.com/api-documentation
- RemoteOK API: https://remoteok.com/api
- Jobicy API/RSS/MCP: https://jobicy.com/jobs-rss-feed
- Arbeitnow API: https://www.arbeitnow.com/api/job-board-api
- Adzuna developer API: https://developer.adzuna.com/
- Reed developer API: https://www.reed.co.uk/developers/
- The Muse API: https://www.themuse.com/developers/api/v2
- Jooble API page: https://jooble.org/api/about
- We Work Remotely categories/RSS: https://weworkremotely.com/categories/remote-programming-jobs
- Apify MCP docs: https://docs.apify.com/platform/integrations/mcp
- Firecrawl MCP docs: https://docs.firecrawl.dev/mcp-server

Sources partiellement bloquees ou non confirmees:

- EURES: portail public accessible, ancienne URL API testee en 404.
- Upwork robots: challenge Cloudflare/403 depuis l'environnement de verification.
- Malt robots: challenge Cloudflare depuis l'environnement de verification.
- Jooble: page API confirmee, mais acces reel/quotas a tester avec cle.

Robots.txt consultes:

- LinkedIn
- Indeed
- Glassdoor
- Freelancer.com
- Fiverr
- PeoplePerHour
- Upwork
- Malt
