# Reference drafts of the abandoned React Native attempt

These files were tracked in the repository before the migration started and are
**not** part of the build (excluded from `tsconfig.json`, ESLint, Jest and
Metro). They reference modules that never existed in this repository
(`@/components/SafeView`, `@/store/UIStore`, `@/database/models/Workspace`,
`phosphor-react-native`, `react-i18next`, NativeWind `className` props, …), so
they do not compile and cannot be reused as-is.

They are kept because they still carry useful intent — the onboarding data
handling copy, the document-parser registry shape, and the OpenAI Responses
adapter sketch — which the Phase 6 UI port can consult when it rebuilds those
surfaces against real modules. MIGRATION_PLAN.md §4 Step 1.3 requires exactly
this treatment: verify before reuse, treat as incomplete source material.
