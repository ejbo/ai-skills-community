-- 员工名单（Employee Directory）+ 用户部门/研究所/隐私账号字段

-- AlterTable
ALTER TABLE "User" ADD COLUMN "department" TEXT,
ADD COLUMN "lab" TEXT,
ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EmployeeDirectory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountNumber" TEXT,
    "department" TEXT NOT NULL DEFAULT '',
    "lab" TEXT NOT NULL DEFAULT '',
    "avatarUrl" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeDirectory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeDirectory_accountNumber_key" ON "EmployeeDirectory"("accountNumber");

-- CreateIndex
CREATE INDEX "EmployeeDirectory_name_idx" ON "EmployeeDirectory"("name");

-- CreateIndex
CREATE INDEX "EmployeeDirectory_department_idx" ON "EmployeeDirectory"("department");

-- CreateIndex
CREATE INDEX "EmployeeDirectory_lab_idx" ON "EmployeeDirectory"("lab");

-- AddForeignKey
ALTER TABLE "EmployeeDirectory" ADD CONSTRAINT "EmployeeDirectory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
