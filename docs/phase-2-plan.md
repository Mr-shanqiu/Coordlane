# Phase 2 plan

Phase 2 should remain protocol-first. It must not introduce a server, daemon,
telemetry, automatic merge, or automatic deployment.

## 1. Publication readiness

- Repeat exact-name searches for `Coordlane` across GitHub, package registries,
  Skill catalogs, and the general web.
- Ask the user to approve the final name, repository owner, and public release.
- Obtain appropriate trademark or legal review if the project will become a
  commercial brand.
- Add contribution and security-reporting guidance before accepting external
  submissions.

## 2. Adapter acceptance

- Record exact product versions and surfaces.
- Install and trigger the Skill in Codex, Claude Code, CodeBuddy, and WorkBuddy.
- Test only documented primitives: create, status, bounded read/wait, directed
  message, shutdown, and recovery where available.
- Downgrade any capability that lacks repeatable evidence.
- Keep WorkBuddy on Manual/Polling until official lifecycle evidence exists.

## 3. Protocol fixtures

- Add a complete Mission document and dependency Chart Schema.
- Add semantic validation for normalized filesystem overlap and duplicate
  external-resource claims.
- Add negative fixtures for premature release, unapproved side effects, cyclic
  dependencies, and shared-entry-point conflicts.
- Decide how schema versions and compatibility will be published.

## 4. Documentation acceptance

- Run the fictional example end to end in at least two different hosts.
- Add screenshots or transcripts only from synthetic data.
- Verify English and Chinese documents describe the same normative boundary.
- Add an explicit comparison page that avoids superiority claims and cites
  dated sources.

## 5. Distribution decision

- Keep the Skill standalone if that is sufficient.
- Consider a plugin only if installation metadata or reviewed adapters require
  one; do not bundle hooks by default.
- Create the public GitHub repository and push only after the user approves the
  local Phase 1 commit and all publication gates above.
