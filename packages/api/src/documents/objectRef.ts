import { TRPCError } from '@trpc/server';

export function toObjectRef(_rawImageUrlOrPath: string, _restaurantId: string): string | null {
  throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'toObjectRef: G-09 in progress' });
}

export async function signObjectRef(_restaurantId: string, _ref: string): Promise<string | null> {
  throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'signObjectRef: G-09 in progress' });
}
