import {
  appendCommonExceptionCode,
  CustomException,
} from 'src/utils/custom-exception';

export class WorkspaceQueryRunnerException extends CustomException<
  keyof typeof WorkspaceQueryRunnerExceptionCode
> {}

export const WorkspaceQueryRunnerExceptionCode = appendCommonExceptionCode({
  INVALID_QUERY_INPUT: 'INVALID_QUERY_INPUT',
  DATA_NOT_FOUND: 'DATA_NOT_FOUND',
  QUERY_TIMEOUT: 'QUERY_TIMEOUT',
  QUERY_VIOLATES_UNIQUE_CONSTRAINT: 'QUERY_VIOLATES_UNIQUE_CONSTRAINT',
  QUERY_VIOLATES_FOREIGN_KEY_CONSTRAINT:
    'QUERY_VIOLATES_FOREIGN_KEY_CONSTRAINT',
  TOO_MANY_ROWS_AFFECTED: 'TOO_MANY_ROWS_AFFECTED',
  NO_ROWS_AFFECTED: 'NO_ROWS_AFFECTED',
} as const);
