import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { InvestmentsController } from './investments.controller.js';
import { InvestmentsService } from './investments.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [InvestmentsController],
  providers: [InvestmentsService],
})
export class InvestmentsModule {}
