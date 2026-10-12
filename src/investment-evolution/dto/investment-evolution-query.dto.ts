import { IsOptional, IsUUID, Matches } from 'class-validator';

export class InvestmentEvolutionQueryDto {
  @IsOptional() @Matches(/^\d{4}$/) year?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) fromMonth?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) toMonth?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsUUID() applicationId?: string;
}
