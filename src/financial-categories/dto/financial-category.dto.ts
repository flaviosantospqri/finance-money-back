import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateFinancialCategoryDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsIn(['income', 'expense'])
  nature!: 'income' | 'expense';
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
}
