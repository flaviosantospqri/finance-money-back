import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateCashBookEntryDto {
  @IsIn(['income', 'expense'])
  type!: 'income' | 'expense';

  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  occurredAt!: string;

  @IsString()
  @MaxLength(160)
  description!: string;

  @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  amount!: string;

  @IsUUID()
  accountId!: string;

  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
