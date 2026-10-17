import {
  IsDateString,
  IsArray,
  ArrayMinSize,
  ArrayUnique,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateForecastDto {
  @IsIn(['income', 'expense']) kind!: 'income' | 'expense';
  @IsString() @MaxLength(160) description!: string;
  @Matches(/^\d{1,12}(\.\d{1,2})?$/) amount!: string;
  @IsOptional() @IsIn(['fixed', 'income_percentage']) amountType?: 'fixed' | 'income_percentage';
  @IsOptional() @Matches(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/) percentage?: string;
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueDate!: string;
  @IsUUID() categoryId!: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsIn(['once', 'monthly', 'weekly', 'yearly']) recurrence!:
    'once' | 'monthly' | 'weekly' | 'yearly';
  @IsInt() @Min(1) @Max(120) occurrenceCount!: number;
  @IsOptional() @IsUUID() destinationId?: string;
  @IsOptional() @IsUUID() groupId?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateForecastDto {
  @IsOptional() @IsString() @MaxLength(160) description?: string;
  @IsOptional() @Matches(/^\d{1,12}(\.\d{1,2})?$/) amount?: string;
  @IsOptional() @IsIn(['fixed', 'income_percentage']) amountType?: 'fixed' | 'income_percentage';
  @IsOptional() @Matches(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/) percentage?: string;
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueDate?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsUUID() destinationId?: string;
  @IsOptional() @IsUUID() groupId?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ReconcileForecastDto {
  @IsOptional() @IsUUID() entryId?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsUUID('4', { each: true }) entryIds?: string[];
  @IsOptional() @Matches(/^\d{1,12}(\.\d{1,2})?$/) amount?: string;
}

export class DistributionDto {
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period!: string;
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) targetPeriod!: string;
}

export class CopyForecastsMonthDto {
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period!: string;
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) targetPeriod!: string;
}

export class CloseForecastDto {
  @IsString() @MaxLength(500) reason!: string;
}

export class CreateDestinationDto {
  @IsString() @MaxLength(100) name!: string;
}

export class CreateForecastGroupDto {
  @IsString() @MaxLength(80) name!: string;
}

export class UpdateForecastGroupDto {
  @IsString() @MaxLength(80) name!: string;
}
