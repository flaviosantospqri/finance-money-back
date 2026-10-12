import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsInt, IsUUID, Matches, Max, Min } from 'class-validator';

export class ReorderCashBookEntriesDto {
  @IsUUID()
  accountId!: string;

  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize!: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  orderedEntryIds!: string[];
}
