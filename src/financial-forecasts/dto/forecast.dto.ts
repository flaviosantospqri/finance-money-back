import {
  IsDateString,
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
  @IsUUID() entryId!: string;
  @IsOptional() @Matches(/^\d{1,12}(\.\d{1,2})?$/) amount?: string;
}

export class DistributionDto {
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
