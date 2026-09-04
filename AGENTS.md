# AGENTS.md - Authoritative Rules & Architecture Constraints

This repository implements the **Teacher Task, Workflow, Performance & Administration Web Application (Version 1)**. All coding agents and contributors must strictly adhere to the following rules:

1. **Treat this specification as authoritative** unless a newer explicit instruction overrides it.
2. **Keep the architecture simple.** Do not introduce a new framework, service, database, queue, or dependency without a clear requirement.
3. **Do not introduce React, Next.js, TypeScript, Redis, queues, microservices, or Docker complexity.**
4. **PostgreSQL is the system of record.** All transactions, relationships, and queries must maintain ACID integrity.
5. **Never store important application state only in the browser.**
6. **Never trust client-provided authorization, campus IDs, resolved recipient lists, roles, or permissions.**
7. **Perform authorization server-side on every request.**
8. **Every administrator database operation must respect campus scope.**
9. **User Type controls portal experience** (`TEACHER`, `ADMIN`, `SUPER_ADMIN`). **Roles and permission overrides control authorization.** Never merge these concepts.
10. **Never expose database IDs or field codes to ordinary reports/UI** when a readable label exists.
11. **Save actual task assignments at publication.**
12. **Never recalculate historical assignments from current attributes.**
13. **Recurring templates affect future instances only.**
14. **Generated recurring task instances are immutable historical snapshots** except for explicitly permitted instance-level actions.
15. **Task publication must recalculate recipients server-side.**
16. **Recipient selection across filter categories uses AND logic.**
17. **Multiple selections inside one category use OR logic** unless an explicit alternate rule is defined.
18. **Always restrict selectable task audience values to selected authorized campuses.**
19. **Always sort teacher-name lists alphabetically** unless another explicit sort is requested.
20. **Search/filter/sort functionality must work on mobile and desktop.**
21. **Every main application page requires a visible Refresh button.**
22. **Maintain a responsive, touch-friendly UI.**
23. **Do not add unnecessary database tables.** Stick to the 12 core tables.
24. **Do not combine unrelated entities merely to reduce table count** if doing so damages integrity or performance.
25. **Prefer human-readable outputs** in exports, reports, and UI.
26. **Use transactions for multi-step critical writes.**
27. **Add unique constraints to prevent duplicates.**
28. **Every important administrative mutation must create an Audit Log entry.**
29. **Never commit secrets.** Use environment variables.
30. **Never log passwords, tokens, secrets, or complete sensitive request payloads.**
31. **Database queries must use parameters.** Never concatenate raw user input into SQL.
32. **Validate all incoming data server-side.**
33. **Report/export authorization must be identical to screen authorization.**
34. **Imports must validate before commit** (Upload -> Parse -> Validate -> Preview -> Commit).
35. **New-data import templates must not contain internal IDs or version numbers.**
36. **Import references should use human-readable values**, with safe uniqueness validation.
37. **Email failures must not normally undo a successfully committed task/group operation.**
38. **Keep files reasonably consolidated**, but split files when they become genuinely difficult to maintain.
39. **Avoid premature abstraction.**
40. **Before marking any feature complete, test happy path, authorization failure, campus isolation, invalid input, empty state, and mobile behaviour.**
