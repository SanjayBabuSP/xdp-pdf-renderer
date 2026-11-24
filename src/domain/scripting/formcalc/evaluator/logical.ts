import { flattenArgs, formCalcTruthy, isNullish, strValue, toNumber } from './shared';
import type { BuiltinFunctionMap } from './shared';

export const LOGICAL_FUNCTIONS: BuiltinFunctionMap = {
  hasvalue: (args) => {
    const v = args[0];
    return v !== null && v !== undefined && strValue(v).trim() !== '' ? 1 : 0;
  },
  hasfinish: () => 0,
  isempty: (args) => (isNullish(args[0]) ? 1 : 0),
  isnan: (args) => (Number.isNaN(toNumber(args[0])) && typeof args[0] === 'number' ? 1 : 0),
  isnull: (args) => (args[0] === null || args[0] === undefined ? 1 : 0),
  issigned: () => 0,

  null: () => null,
  appear: (args) => args[0] ?? args[1],
  oneof: (args) => {
    const flat = flattenArgs(args);
    const val = flat[0];
    for (let i = 1; i < flat.length; i++) {
      if (val === flat[i]) return 1;
      if (
        !isNullish(val) &&
        !isNullish(flat[i]) &&
        typeof val !== 'string' &&
        typeof flat[i] !== 'string' &&
        toNumber(val) === toNumber(flat[i]) &&
        !isNullish(flat[i])
      )
        return 1;
    }
    return 0;
  },
  choose: (args) => {
    if (args[0] === null || args[0] === undefined) return null;
    const n = Math.floor(toNumber(args[0]));
    if (n < 1 || n > args.length - 1) return '';
    return args[n];
  },

  exists: (args) => (args[0] !== null && args[0] !== undefined ? 1 : 0),
  within: (args) => {
    const val = toNumber(args[0]);
    const low = toNumber(args[1]);
    const high = toNumber(args[2]);
    return val >= low && val <= high ? 1 : 0;
  },

  if: (args) => (formCalcTruthy(args[0]) ? args[1] : args.length > 2 ? args[2] : null),
};
