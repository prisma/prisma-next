import type { Brand } from '@prisma-next/contract/types';

export type ErrorMessage = `[error] ${string}`;

/**
 * An error type indicating that the previous function call had bad input.
 * To be used as a return type.
 *
 * @template TMessage The error message.
 */
export type PreviousFunctionReceivedBadInputError<TMessage extends ErrorMessage> = Brand<TMessage>;

/**
 * An error type indicating that the provided table reference is too wide.
 * To be used as a `never` alternative in conditional types.
 *
 * @template TMessage The error message.
 */
export type TableReferenceTooWideError<TMessage extends ErrorMessage> = Brand<TMessage>;
