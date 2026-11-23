// Configuration guide: https://rstack.rs/config
import { define } from 'rstack';

define.test({
  testEnvironment: 'node',
  include: ['tests/**/*.test.ts'],
});
