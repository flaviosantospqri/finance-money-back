import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateFinancialCategoryDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsIn(['income', 'expense'])
  nature!: 'income' | 'expense';

  @IsOptional()
  @IsUUID()
  destinationId?: string;
}

export class UpdateFinancialCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(['income', 'expense'])
  nature?: 'income' | 'expense';

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsUUID()
  destinationId?: string;
}
