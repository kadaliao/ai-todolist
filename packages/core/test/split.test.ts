import { describe, expect, it } from 'vitest';
import { splitSentences } from '../src/parser/split';

describe('splitSentences (brain dump without AI)', () => {
  it('splits lines and sentence ends', () => {
    expect(splitSentences('买牛奶\n交房租\n\n健身')).toEqual(['买牛奶', '交房租', '健身']);
    expect(splitSentences('明天上午写周报。下午三点设计评审！周五前交房租？')).toEqual([
      '明天上午写周报',
      '下午三点设计评审',
      '周五前交房租',
    ]);
  });

  it('splits spoken text at a comma before 还有 / 然后 / and then, dropping the connector', () => {
    expect(splitSentences('明天上午先把周报写完，然后下午三点和设计评审，还有每周一健身。')).toEqual([
      '明天上午先把周报写完',
      '下午三点和设计评审',
      '每周一健身',
    ]);
    expect(splitSentences('Call mom tomorrow, and then book the dentist. Also renew passport')).toEqual([
      'Call mom tomorrow',
      'book the dentist',
      'renew passport',
    ]);
  });

  it('keeps commas inside one item, decimals, and drops one-character noise', () => {
    expect(splitSentences('明天上午，先把周报写完。嗯。')).toEqual(['明天上午，先把周报写完']);
    expect(splitSentences('Upgrade to 3.5 by Friday.')).toEqual(['Upgrade to 3.5 by Friday']);
    expect(splitSentences('   ')).toEqual([]);
  });
});
