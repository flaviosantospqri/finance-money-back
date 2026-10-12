import { IsUUID, Matches } from 'class-validator';

export class CashBookSummaryQueryDto {
  @IsUUID()
  accountId!: string;

  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month!: string;
}
