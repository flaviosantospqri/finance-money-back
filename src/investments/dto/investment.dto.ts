import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateInvestmentApplicationDto {
  @IsString() @MaxLength(120) name!: string;
  @IsUUID() accountId!: string;
  @IsString() @MaxLength(80) investmentType!: string;
  @IsOptional() @IsString() @MaxLength(120) institution?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateInvestmentApplicationDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsString() @MaxLength(80) investmentType?: string;
  @IsOptional() @IsString() @MaxLength(120) institution?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateInvestmentTransactionDto {
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  occurredAt!: string;
  @IsIn(['contribution', 'withdrawal', 'income', 'adjustment']) type!: 'contribution' | 'withdrawal' | 'income' | 'adjustment';
  @Matches(/^-?\d{1,12}(\.\d{1,2})?$/) amount!: string;
  @IsOptional() @IsString() @MaxLength(120) origin?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateInvestmentTransactionDto {
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  occurredAt?: string;
  @IsOptional() @IsIn(['contribution', 'withdrawal', 'income', 'adjustment']) type?: 'contribution' | 'withdrawal' | 'income' | 'adjustment';
  @IsOptional() @Matches(/^-?\d{1,12}(\.\d{1,2})?$/) amount?: string;
  @IsOptional() @IsString() @MaxLength(120) origin?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
}

export class InvestmentQueryDto {
  @Matches(/^\d{4}-\d{2}$/) month!: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsUUID() applicationId?: string;
}
