import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// why: @testing-library/react checks this flag to wrap state updates in act(); without it React logs warnings during user-event interactions.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
