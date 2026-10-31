// The vitest config compiles JSX with the classic runtime (React.createElement)
// and has no React plugin; component tests import this FIRST so `React` exists
// as a global when the component modules evaluate.
import * as React from 'react';

(globalThis as unknown as { React: typeof React }).React = React;
