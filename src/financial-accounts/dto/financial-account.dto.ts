import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateFinancialAccountDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsIn(['checking', 'payment', 'cash', 'investment'])
  type!: 'checking' | 'payment' | 'cash' | 'investment';

  @Matches(/^-?\d{1,12}(\.\d{1,2})?$/)
  openingBalance!: string;

  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  referenceDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  institution?: string;
}

export class UpdateFinancialAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(['checking', 'payment', 'cash', 'investment'])
  type?: 'checking' | 'payment' | 'cash' | 'investment';

  @IsOptional()
  @Matches(/^-?\d{1,12}(\.\d{1,2})?$/)
  openingBalance?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  referenceDate?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  institution?: string | null;
}
