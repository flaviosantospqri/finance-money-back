import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class RepasseInputDto {
  @IsString() @MaxLength(100) name!: string;
  @IsIn(['percentage', 'fixed']) valueType!: 'percentage' | 'fixed';
  @Matches(/^\d{1,12}(\.\d{1,2})?$/) value!: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) effectiveFrom!: string;
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) effectiveTo?: string | null;
}
