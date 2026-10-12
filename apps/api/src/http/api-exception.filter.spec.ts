import type { ArgumentsHost } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from './api-exception.filter.js';

const host = (response: object) => ({ switchToHttp: () => ({ getResponse: () => response }) }) as unknown as ArgumentsHost;

beforeAll(() => Logger.overrideLogger(false));

describe('ApiExceptionFilter', () => {
  it('answers with the JSON error before anything was sent', () => {
    const json = vi.fn();
    const response = { headersSent: false, set: vi.fn(), status: vi.fn(() => ({ json })), end: vi.fn() };
    new ApiExceptionFilter().catch(new Error('boom'), host(response));
    expect(response.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ code: 'internal_error', message: 'internal server error' });
  });

  it('only ends the response when headers are already out (an open stream), instead of throwing', () => {
    const response = { headersSent: true, set: vi.fn(), status: vi.fn(), end: vi.fn() };
    expect(() => new ApiExceptionFilter().catch(new Error('late'), host(response))).not.toThrow();
    expect(response.status).not.toHaveBeenCalled();
    expect(response.set).not.toHaveBeenCalled();
    expect(response.end).toHaveBeenCalledOnce();
  });
});
