import { afterEach, describe, expect, test } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatWidget } from '../src/widget/ChatWidget.jsx';
import { mountWidget } from '../src/widget/mount.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('ChatWidget', () => {
  test('opens and closes from the launcher', () => {
    render(<ChatWidget />);
    const launcher = screen.getByRole('button', { name: 'AI 도우미 열기' });

    fireEvent.click(launcher);
    expect(screen.getByRole('dialog', { name: '블로그 AI 도우미' })).toBeTruthy();
    expect(launcher.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('Escape closes and returns focus to the launcher', () => {
    render(<ChatWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 도우미 열기' }));
    const input = screen.getByLabelText('질문');
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'AI 도우미 열기' }));
  });

  test('Phase 0 shows a not-ready notice and keeps send disabled', () => {
    render(<ChatWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 도우미 열기' }));
    expect(screen.getByRole('status').textContent).toContain('준비 중');
    expect(screen.getByRole('button', { name: '전송' }).disabled).toBe(true);
  });
});

describe('mountWidget', () => {
  test('mounts once per element', async () => {
    const element = document.createElement('div');
    document.body.append(element);

    let first;
    await act(async () => {
      first = mountWidget(element);
    });
    const second = mountWidget(element);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(element.querySelectorAll('.aia-launcher')).toHaveLength(1);
    await act(async () => first.unmount());
  });

  test('missing element is a no-op', () => {
    expect(mountWidget(null)).toBeNull();
  });
});
