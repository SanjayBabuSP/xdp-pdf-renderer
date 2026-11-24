import type { BuiltinFunctionMap } from './shared';
import { DATE_FUNCTIONS } from './date';
import { LOGICAL_FUNCTIONS } from './logical';
import { MATH_FUNCTIONS } from './math';
import { MISC_FUNCTIONS } from './misc';
import { STRING_FUNCTIONS } from './string';

export const BUILTIN_FUNCTIONS: BuiltinFunctionMap = {
  ...MATH_FUNCTIONS,
  ...STRING_FUNCTIONS,
  ...DATE_FUNCTIONS,
  ...LOGICAL_FUNCTIONS,
  ...MISC_FUNCTIONS,
};
