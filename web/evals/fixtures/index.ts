import m01 from './m01.json';
import m02 from './m02.json';
import m03 from './m03.json';
import m04 from './m04.json';
import m05 from './m05.json';

export const FIXTURES = [m01, m02, m03, m04, m05] as const;

export type MatchFixture = typeof m01;
