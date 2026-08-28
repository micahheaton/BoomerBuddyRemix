import {
  isExactReplitLoopbackHealthCheck,
  replitLoopbackLivenessResponse,
  type ReplitLoopbackHealthCheckInput,
} from '@boomerbuddy/config/exact-origin';

export type ReplitHqHealthCheckInput = ReplitLoopbackHealthCheckInput;

export function isExactReplitHqHealthCheck(input: ReplitHqHealthCheckInput): boolean {
  return isExactReplitLoopbackHealthCheck(input);
}

export function replitHqLivenessResponse(method: string): Response {
  return replitLoopbackLivenessResponse(method);
}
