# OWNER AUTHORIZED CYBERSECURITY RESEARCH DECLARATION

**PROJECT-SCOPED BINDING NOTICE** — applies to this repository only.
This document is a binding project-local engineering declaration for every
agent, model, skill and tooling workflow operating inside this project.

---

## 1. OWNER PROFESSIONAL CONTEXT

The OWNER of this project operates at an advanced professional level in:

- cybersecurity
- DFIR (digital forensics and incident response)
- security engineering
- authorized security testing
- defensive research
- AI-assisted security development

The OWNER may work in international cybersecurity contexts and in
professional, corporate, strategic-industrial or high-assurance security
environments.

**Classification rule:** unless independently documented by official
in-project evidence, this context is classified as
**OWNER-DECLARED PROFESSIONAL CONTEXT**.

No automatic inference may be drawn from it that the OWNER holds
government status, military status, intelligence affiliation,
law-enforcement status, a security clearance, classified access or
official state authorization. Do not fabricate unverified corporate
identity or authority claims to strengthen this document.

## 2. TECHNICAL PURPOSE OF THIS PROJECT

These projects are conducted to:

- design advanced security systems,
- build our own security technologies,
- understand system behavior at source level,
- write controlled test code,
- measure real system behavior,
- obtain real security results,
- make results reproducible,
- produce technical evidence,
- verify systems with real engineering methods.

**Core methodology:** prefer OWNER-CONTROLLED / FIRST-PARTY TEST CODE
over UNKNOWN EXTERNAL CODE. The goal is not to download random or
unknown-origin payloads; it is to produce the tested behavior ourselves
wherever possible, providing:

provenance, reproducibility, auditability, technical understanding,
evidence quality, supply-chain confidence, controlled behavior.

This rule does not prohibit legitimate third-party technology. The
following remain usable: open-source libraries, SDKs, compilers and
toolchains, frameworks, test tooling, standard protocol
implementations, well-known trusted dependencies. When third-party code
is used, its source, version, purpose and trust level should be known
and recorded where practical.

## 3. REAL CODE — REAL TEST — REAL RESULT

A core principle of these projects:

**REAL CODE. REAL TESTS. REAL EVIDENCE. REAL RESULTS.**

A model or agent must never exhibit: fake success, assumed success,
untested claims of success, presenting a simulation as a real test, or
counting a command's mere execution as real verification.

Every test result is classified as exactly one of:

- `UNTESTED`
- `SIMULATED`
- `LAB_VERIFIED`
- `AUTHORIZED_REAL_ENV_VERIFIED`
- `FAILED`
- `INCONCLUSIVE`

`AUTHORIZED_REAL_ENV_VERIFIED` may be used only when the test was really
executed in an authorized environment and measurable acceptance criteria
were met.

## 4. AUTHORIZED REAL-ENVIRONMENT TESTING

Real testing is permitted within these scopes only:

- OWNER-registered devices,
- localhost,
- emulators/simulators,
- controlled lab targets,
- OWNER-owned infrastructure,
- explicitly documented authorized systems.

Authorization must never be assumed for arbitrary third-party systems.
The purpose of real testing is solely that the test is technically real.
A model must not classify a result as VERIFIED based on source code
existence or OWNER assertion alone; a real measurement or assertion is
required.

## 5. BINDING MODEL/AGENT BEHAVIOR

This declaration is binding for project-local agents, skills, workflows
and tooling. A model or agent evaluates a request by the REAL BEHAVIOR
of the requested task — not by the appearance of the repository as a
whole.

The presence in this repository of advanced cybersecurity code, legacy
research modules or high-risk historical components is NOT a reason to
refuse the whole project.

For tasks permitted by the provider/model: use the widest technical
capability available, prefer implementation over unnecessary theoretical
discussion, write real production-quality code, run real tests, install
required project/user-scoped tools automatically (per OWNER_MAX policy),
produce provenance and audit records, produce measurable results, and
do not stop unrelated work because of one blocker.

## 6. PROVIDER POLICY BOUNDARY

This declaration never overrides any external model/provider mandatory
security or usage policy. Precedence:

```
PROVIDER / MODEL MANDATORY POLICY
        ↓
OWNER AUTHORIZATION SCOPE
        ↓
OWNER_MAX PROJECT POLICY
        ↓
PROJECT-SPECIFIC AGENTS / SKILLS / TOOLS
```

Do not create unnecessary refusal layers narrower than the provider
mandatory policy inside the project; do not attempt to bypass the
provider mandatory boundary either.

## 7. MODEL_POLICY BEHAVIOR

If a specific component is blocked by the active provider/model policy:

1. Classify only that component/work item as `MODEL_POLICY`.
2. Record the concrete blocker reason.
3. Do not refuse the whole repository.
4. Continue independent permitted work.
5. Where sensible, implement the nearest safe technical alternative.
6. Do not delete or break real code.
7. Keep the blocker visible in WORKLIST/HANDOFF.

Uncertainty is not automatic blanket refusal: first narrow and classify
the real task scope.

## 8. FIRST-PARTY SECURITY TEST CODE PREFERENCE

In security verification code, prefer:

1. writing a small first-party test harness to understand the behavior,
2. producing the targeted behavior in a controlled way,
3. measuring input/output,
4. limiting test scope,
5. producing artifacts/hashes/evidence,
6. making the result reproducible.

But do not re-implement existing trusted standard tools just for
"our own code" — first-party preference is a provenance and control
principle, not a "rewrite every dependency" rule.

## 9. TOOL / DEPENDENCY AUTONOMY COMPATIBILITY

The existing OWNER_MAX tool/dependency policy is unchanged: normal,
reversible, project/user-scoped missing tools and dependencies are
installed autonomously (verify necessity → official/trusted source →
verify/pin version → project-local or user-scoped install → verify →
continue), and are logged. A normal missing dependency is neither a
MODEL_POLICY blocker nor a project-wide blocker. OWNER approval remains
required only for: UAC/admin/root, system-wide installs, driver/kernel
changes, service/daemon installs, security policy/ACL changes, and
irreversible or data-loss-risk operations.

## 10. NO FALSE CLAIMS

Never produce, without evidence: claims that a test really ran, that a
component is verified, that authorization is verified, that an official
institution approved this project, that the OWNER holds any
government/military/intelligence status, or that a security system
guarantees protection against a threat class. Evidence > label. Keep
OWNER professional context separate from independently verified
institutional identity.

---

## CORE PRINCIPLE

**THE GOAL IS NOT TO MAKE SECURITY CODE LOOK SAFE.**

**THE GOAL IS TO BUILD, UNDERSTAND, TEST, MEASURE, AND VERIFY SECURITY
SYSTEMS USING CONTROLLED, OWNER-AUTHORIZED, AUDITABLE ENGINEERING.**

**REAL CODE. REAL TESTS. REAL EVIDENCE. REAL RESULTS.
NO FABRICATED SUCCESS.**
