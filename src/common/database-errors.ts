import { BadRequestException, ConflictException } from '@nestjs/common';

export function rethrowDatabaseError(error: unknown): never {
  const code = (error as { code?: string } | null)?.code;
  const constraint = (error as { constraint?: string } | null)?.constraint;
  if (code === '23505' && constraint === 'financial_categories_destination_name_nature_key') {
    throw new ConflictException('Já existe uma categoria com este nome e natureza nesta origem. O mesmo nome pode ser usado em outra origem.');
  }
  if (code === '23505') throw new ConflictException('Já existe um registro com esses dados.');
  if (code === '23503' || code === '23514' || code === '22003' || code === '22008' || code === '22P02') {
    throw new BadRequestException('Os dados informados são incompatíveis ou inválidos.');
  }
  throw error;
}

export function assertPositiveAmount(value: string) {
  const cents = BigInt(value.replace('.', '').replace(/^0+/, '') || '0');
  if (cents <= 0n) throw new BadRequestException('O valor deve ser maior que zero.');
}
