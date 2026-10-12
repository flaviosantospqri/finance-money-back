import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateTransferDto {
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  occurredAt!: string;

  @IsString()
  @MaxLength(160)
  description!: string;

  @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  amount!: string;

  @IsUUID()
  sourceAccountId!: string;

  @IsUUID()
  destinationAccountId!: string;

  @IsOptional()
  @IsUUID()
  sourceApplicationId?: string;

  @IsOptional()
  @IsUUID()
  destinationApplicationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateTransferDto {
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  occurredAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  description?: string;

  @IsOptional()
  @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  amount?: string;

  @IsOptional()
  @IsUUID()
  sourceAccountId?: string;

  @IsOptional()
  @IsUUID()
  destinationAccountId?: string;

  @IsOptional()
  @IsUUID()
  sourceApplicationId?: string | null;

  @IsOptional()
  @IsUUID()
  destinationApplicationId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}
