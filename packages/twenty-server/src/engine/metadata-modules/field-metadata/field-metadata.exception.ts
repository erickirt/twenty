import {
  appendCommonExceptionCode,
  CustomException,
} from 'src/utils/custom-exception';

export class FieldMetadataException extends CustomException<
  keyof typeof FieldMetadataExceptionCode
> {}

export const FieldMetadataExceptionCode = appendCommonExceptionCode({
  FIELD_METADATA_NOT_FOUND: 'FIELD_METADATA_NOT_FOUND',
  INVALID_FIELD_INPUT: 'INVALID_FIELD_INPUT',
  FIELD_MUTATION_NOT_ALLOWED: 'FIELD_MUTATION_NOT_ALLOWED',
  FIELD_ALREADY_EXISTS: 'FIELD_ALREADY_EXISTS',
  OBJECT_METADATA_NOT_FOUND: 'OBJECT_METADATA_NOT_FOUND',
  FIELD_METADATA_RELATION_NOT_ENABLED: 'FIELD_METADATA_RELATION_NOT_ENABLED',
  FIELD_METADATA_RELATION_MALFORMED: 'FIELD_METADATA_RELATION_MALFORMED',
  LABEL_IDENTIFIER_FIELD_METADATA_ID_NOT_FOUND:
    'LABEL_IDENTIFIER_FIELD_METADATA_ID_NOT_FOUND',
  UNCOVERED_FIELD_METADATA_TYPE_VALIDATION:
    'UNCOVERED_FIELD_METADATA_TYPE_VALIDATION',
} as const);
