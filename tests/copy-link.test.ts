import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../src/client/App';

function installDocument({
  secure,
  execCommand = () => true,
}: {
  secure: boolean;
  execCommand?: () => boolean;
}) {
  const textarea = {
    value: '',
    style: {},
    setAttribute: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
    focus: vi.fn(),
  };
  const appendChild = vi.fn();
  const removeChild = vi.fn();
  const createElement = vi.fn(() => textarea);
  const command = vi.fn(execCommand);

  vi.stubGlobal('document', {
    body: { appendChild, removeChild },
    activeElement: null,
    createElement,
    execCommand: command,
  });
  vi.stubGlobal('window', { isSecureContext: secure });

  return { textarea, appendChild, removeChild, createElement, command };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('copyText', () => {
  it('uses the Clipboard API in a secure context', async () => {
    installDocument({ secure: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyText('https://example.com/books/1')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://example.com/books/1');
  });

  it('falls back to execCommand over plain HTTP', async () => {
    const dom = installDocument({ secure: false });
    vi.stubGlobal('navigator', {});

    await expect(copyText('http://example.com/books/1')).resolves.toBe(true);
    expect(dom.createElement).toHaveBeenCalledWith('textarea');
    expect(dom.textarea.value).toBe('http://example.com/books/1');
    expect(dom.appendChild).toHaveBeenCalledWith(dom.textarea);
    expect(dom.command).toHaveBeenCalledWith('copy');
    expect(dom.removeChild).toHaveBeenCalledWith(dom.textarea);
  });

  it('falls back when the Clipboard API rejects', async () => {
    const dom = installDocument({ secure: true });
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyText('https://example.com/books/1')).resolves.toBe(true);
    expect(dom.command).toHaveBeenCalledWith('copy');
  });

  it('reports failure when execCommand fails', async () => {
    installDocument({ secure: false, execCommand: () => false });
    vi.stubGlobal('navigator', {});

    await expect(copyText('http://example.com/books/1')).resolves.toBe(false);
  });
});
