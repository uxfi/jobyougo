# Customization Guide

## Profile (config/profile.yml)

This is the single source of truth for your identity. All modes read from here.

Key sections:
- **candidate**: Name, email, phone, location, LinkedIn, portfolio
- **target_roles**: Your North Star roles and archetypes
- **narrative**: Your headline, exit story, superpowers, proof points
- **compensation**: Target range, minimum, currency
- **location**: Country, timezone, visa status, on-site availability
- **search**: Contract types, sector preferences, geography preferences, must-haves, deal-breakers

## Target Roles (modes/_shared.md)

The archetype table in `_shared.md` determines how offers are scored and CVs are framed. Edit the table to match YOUR career targets:

```markdown
| Archetype | Thematic axes | What they buy |
|-----------|---------------|---------------|
| **Your Role 1** | key skills | what they need |
| **Your Role 2** | key skills | what they need |
```

Also update the "Adaptive Framing" table to map YOUR specific projects to each archetype.

## Portals (portals.yml)

Copy from `templates/portals.example.yml` and customize:

1. **title_filter.positive**: Keywords matching your target roles
2. **title_filter.negative**: Tech stacks or domains to exclude
3. **remote_filter.required_any**: Explicit remote wording required before an offer can pass
4. **remote_filter.allowed_geo_any**: Compatible full-remote geographies, such as worldwide/global, Europe/EMEA/EU, Asia/APAC, Singapore, Hong Kong, Japan, Thailand, and Dubai/UAE
5. **remote_filter.rejected_geo_any**: Remote geographies to skip, such as US-only, Canada-only, LATAM/Latin America, Americas, North America, and South America
6. **search_queries / eu_job_boards / freelance_portals**: WebSearch queries for job boards, national portals, Asia boards, and freelance/contract marketplaces
7. **rss_feeds**: Public RSS/XML feeds such as Jobicy, Himalayas, RemoteOK, We Work Remotely, and Authentic Jobs
8. **api_aggregators**: Public or credentialed APIs such as Remotive, Jobicy, Himalayas, Arbeitnow, SearchAPI/SerpApi, TheirStack, Adzuna, Jooble, and Careerjet
9. **tracked_companies**: Companies to check directly

Remote filtering is deliberately conservative. A listing must show both explicit remote wording and compatible geography in the extracted title/location/remote evidence. The scanner does not treat the URL or domain as proof, and a title like "Global Product Manager - Remote" is not enough unless the location or remote evidence confirms worldwide/global remote.

Every source `name` must be unique across all scanner sections because selection and cooldown state use `name` as the key. See `docs/job-source-coverage.md` for provider names, optional API keys, and platform restrictions.

## CV Template (templates/cv-template.html)

The HTML template uses these design tokens:
- **Fonts**: Space Grotesk (headings) + DM Sans (body) -- self-hosted in `fonts/`
- **Colors**: Cyan primary (`hsl(187,74%,32%)`) + Purple accent (`hsl(270,70%,45%)`)
- **Layout**: Single-column, ATS-optimized

To customize fonts/colors, edit the CSS in the template. Update font files in `fonts/` if switching fonts.

## Negotiation Scripts (modes/_shared.md)

The negotiation section provides frameworks for salary discussions. Replace the example scripts with your own:
- Target ranges
- Geographic arbitrage strategy
- Pushback responses

## Hooks (Optional)

Career-ops can integrate with external systems via Claude Code hooks. Example hooks:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "echo 'Career-ops session started'"
      }]
    }]
  }
}
```

Save hooks in `.claude/settings.json`.

## States (templates/states.yml)

The canonical states rarely need changing. If you add new states, update:
1. `templates/states.yml`
2. `normalize-statuses.mjs` (alias mappings)
3. `modes/_shared.md` (any references)
