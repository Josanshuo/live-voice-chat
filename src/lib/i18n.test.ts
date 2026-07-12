import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getLang, setLang, t } from './i18n';

describe('i18n', () => {
  let originalLang = getLang();

  beforeEach(() => {
    originalLang = getLang();
  });

  afterEach(() => {
    setLang(originalLang);
  });

  it('should switch languages correctly', () => {
    setLang('zh');
    expect(getLang()).toBe('zh');
    setLang('en');
    expect(getLang()).toBe('en');
  });

  it('should translate correctly in English', () => {
    setLang('en');
    expect(t('role.you')).toBe('You');
    // test template replacement
    expect(t('openai.connectFailed', '500', 'Server Error')).toBe('Realtime connection failed (500): Server Error');
  });

  it('should translate correctly in Chinese', () => {
    setLang('zh');
    expect(t('role.you')).toBe('你');
    // test template replacement
    expect(t('openai.connectFailed', '404', 'Not Found')).toBe('Realtime 连接失败 (404): Not Found');
  });
});
